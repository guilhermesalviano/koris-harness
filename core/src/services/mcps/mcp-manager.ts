import {
  Client,
  StreamableHTTPClientTransport,
  type AuthProvider,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/client';
import type { ILogger } from '../../infrastructure/logger';
import type { McpServerDefinition } from '../../../../plugins/mcps/contracts';
import { COMMANDS, type ToolDefinition, type ToolResult } from '../../../../plugins/tools/contracts';
import type { PluginRegistry } from '../../../../plugins/registry';
import { ToolPluginsSingleton } from '../tools/registry-singleton';

export type McpConnectionState = 'disabled' | 'connecting' | 'connected' | 'error';

export interface McpServerStatus {
  name: string;
  state: McpConnectionState;
  toolCount: number;
  error?: string;
}

export interface McpClientHandle {
  listTools(): Promise<{ tools: Tool[] }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }, options?: { toolDefinition?: Tool }): Promise<CallToolResult>;
  close(): Promise<void>;
}

export type McpClientFactory = (
  definition: McpServerDefinition,
  onToolsChanged: (error: Error | null, tools?: Tool[] | null) => void,
) => Promise<McpClientHandle>;

interface ActiveServer {
  client: McpClientHandle;
  disposers: Array<() => void>;
}

// OpenAI-compatible providers reject function names longer than 64 characters.
const MAX_TOOL_NAME_LENGTH = 64;
// Bounds the session DELETE on shutdown/disable so an unreachable server
// cannot stall `stopAll()`.
const TERMINATE_TIMEOUT_MS = 3_000;

/**
 * Node's fetch reports every network failure as a bare "fetch failed" and
 * hides the actual reason (ECONNREFUSED, ENOTFOUND, socket closed…) in
 * `cause` — surface it so a transport failure is diagnosable from the logs.
 * The MCP SDK's `SdkError` takes `(code, message, data)`, so the `{ cause }`
 * it passes lands on `data.cause` rather than `cause`; follow both.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const causeOf = (value: Error): unknown => {
    const { cause, data } = value as { cause?: unknown; data?: { cause?: unknown } };
    return cause ?? data?.cause;
  };
  const details: string[] = [];
  let cause = causeOf(error);
  while (cause instanceof Error && details.length < 3) {
    if (cause.message && !error.message.includes(cause.message)) details.push(cause.message);
    cause = causeOf(cause);
  }
  return details.length > 0 ? `${error.message} (${details.join(': ')})` : error.message;
}

function validatedUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('MCP URL must use http or https.');
  }
  return url;
}

function exposedToolName(serverName: string, remoteName: string): string {
  const normalized = remoteName.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!normalized) throw new Error(`MCP tool "${remoteName}" has no usable name.`);
  const exposed = `${serverName}__${normalized}`;
  if (exposed.length > MAX_TOOL_NAME_LENGTH) {
    throw new Error(`MCP tool name "${exposed}" exceeds ${MAX_TOOL_NAME_LENGTH} characters.`);
  }
  return exposed;
}

function serializeResult(result: CallToolResult): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const textOnly = content.every((block) => block.type === 'text');
  if (textOnly && result.structuredContent === undefined) {
    return content.map((block) => (block as { text: string }).text).join('\n');
  }
  return JSON.stringify({ content, structuredContent: result.structuredContent });
}

/**
 * `isError` means the call reached the server and the *server's* tool
 * reported a failure — label it so it cannot be mistaken for a Koris-side
 * transport error in logs or by the model.
 */
function toToolResult(serverName: string, toolName: string, result: CallToolResult): ToolResult {
  const serialized = serializeResult(result);
  return result.isError
    ? { toolName, success: false, error: `MCP server "${serverName}" returned an error: ${serialized || 'no details'}` }
    : { toolName, success: true, result: serialized };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function createHttpClient(
  definition: McpServerDefinition,
  onToolsChanged: (error: Error | null, tools?: Tool[] | null) => void,
): Promise<McpClientHandle> {
  const config = definition.loadConfig();
  const url = validatedUrl(config.url);
  const authProvider: AuthProvider | undefined = config.bearerToken
    ? { token: async () => config.bearerToken }
    : undefined;
  const transport = new StreamableHTTPClientTransport(url, { authProvider });
  const client = new Client(
    { name: `koris-${definition.name}`, version: '1.0.0' },
    {
      versionNegotiation: { mode: 'auto' },
      listChanged: {
        tools: {
          onChanged: (error, tools) => onToolsChanged(error, tools),
        },
      },
    },
  );
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
  return {
    listTools: () => client.listTools(),
    callTool: (params, options) => client.callTool(params, options),
    close: async () => {
      try {
        await withTimeout(transport.terminateSession(), TERMINATE_TIMEOUT_MS, 'MCP session termination');
      } finally {
        await client.close();
      }
    },
  };
}

export class McpManager {
  private readonly active = new Map<string, ActiveServer>();
  // In-flight connects: startAll, hot-load, `/mcps enable` and the admin
  // toggle can race, and each must share one attempt instead of opening (and
  // leaking) its own session.
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly statuses = new Map<string, McpServerStatus>();

  constructor(
    private readonly logger: ILogger,
    private readonly registry: PluginRegistry,
    private definitions: McpServerDefinition[],
    private readonly clientFactory: McpClientFactory = createHttpClient,
  ) {
    for (const definition of definitions) {
      this.statuses.set(definition.name, {
        name: definition.name,
        state: definition.enabled() ? 'connecting' : 'disabled',
        toolCount: 0,
      });
    }
  }

  async startAll(): Promise<void> {
    await Promise.all(this.definitions.filter((definition) => definition.enabled()).map((definition) => this.enable(definition.name)));
  }

  enable(name: string): Promise<boolean> {
    const definition = this.definitions.find((candidate) => candidate.name === name);
    if (!definition) return Promise.resolve(false);
    if (this.active.has(name)) return Promise.resolve(true);
    const inFlight = this.pending.get(name);
    if (inFlight) return inFlight;

    const attempt = this.connect(definition).finally(() => this.pending.delete(name));
    this.pending.set(name, attempt);
    return attempt;
  }

  async disable(name: string): Promise<boolean> {
    // Let an in-flight connect settle first, otherwise it would register the
    // server's tools right after this disable returned.
    await this.pending.get(name);
    await this.teardown(name);
    if (!this.definitions.some((definition) => definition.name === name)) return false;
    this.statuses.set(name, { name, state: 'disabled', toolCount: 0 });
    return true;
  }

  async reconnect(name: string): Promise<boolean> {
    await this.disable(name);
    return this.enable(name);
  }

  async stopAll(): Promise<void> {
    const names = new Set([...this.active.keys(), ...this.pending.keys()]);
    await Promise.all([...names].map((name) => this.disable(name)));
  }

  private async connect(definition: McpServerDefinition): Promise<boolean> {
    const { name } = definition;
    this.statuses.set(name, { name, state: 'connecting', toolCount: 0 });
    try {
      let handle: McpClientHandle | undefined;
      handle = await this.clientFactory(definition, (error, tools) => {
        if (error) {
          this.logger.warn(`[mcp] Failed to refresh tools for "${name}"`, { error: describeError(error) });
          return;
        }
        if (handle && tools) this.replaceTools(definition, handle, tools);
      });
      this.active.set(name, { client: handle, disposers: [] });
      const { tools } = await handle.listTools();
      this.replaceTools(definition, handle, tools);
      this.logger.info(`[mcp] Connected "${name}" with ${tools.length} tool(s)`);
      return true;
    } catch (error) {
      const message = describeError(error);
      // Not `disable()`: it waits on this very attempt and would deadlock.
      await this.teardown(name);
      this.statuses.set(name, { name, state: 'error', toolCount: 0, error: message });
      this.logger.warn(`[mcp] Failed to connect "${name}"`, { error: message });
      return false;
    }
  }

  private async teardown(name: string): Promise<void> {
    const server = this.active.get(name);
    if (!server) return;
    for (const dispose of server.disposers) dispose();
    this.active.delete(name);
    this.publishTools();
    try {
      await server.client.close();
    } catch (error) {
      this.logger.warn(`[mcp] Failed to close "${name}" cleanly`, { error: describeError(error) });
    }
  }

  getStatuses(): McpServerStatus[] {
    return this.definitions.map((definition) => this.statuses.get(definition.name) ?? {
      name: definition.name,
      state: 'disabled',
      toolCount: 0,
    });
  }

  getDefinition(name: string): McpServerDefinition | undefined {
    return this.definitions.find((definition) => definition.name === name);
  }

  async addDefinitions(definitions: McpServerDefinition[]): Promise<void> {
    const known = new Set(this.definitions.map((definition) => definition.name));
    const added = definitions.filter((definition) => !known.has(definition.name));
    this.definitions = [...this.definitions, ...added];
    for (const definition of added) {
      this.statuses.set(definition.name, { name: definition.name, state: 'disabled', toolCount: 0 });
      if (definition.enabled()) await this.enable(definition.name);
    }
  }

  private replaceTools(definition: McpServerDefinition, client: McpClientHandle, tools: Tool[]): void {
    const active = this.active.get(definition.name);
    if (!active || active.client !== client) return;
    for (const dispose of active.disposers) dispose();
    active.disposers = [];

    const names = new Set<string>();
    for (const tool of tools) {
      try {
        const exposedName = exposedToolName(definition.name, tool.name);
        if (names.has(exposedName) || this.registry.collect(COMMANDS).some((item) => item.name === exposedName)) {
          this.logger.warn(`[mcp] Skipping duplicate tool "${exposedName}" from "${definition.name}"`);
          continue;
        }
        names.add(exposedName);
        const adapted: ToolDefinition = {
          name: exposedName,
          schema: {
            // Origin label so the model can tell an external app's action
            // (e.g. adding a row to its todo list) from the agent's own tools.
            description: `[${definition.name} MCP server] ${tool.description ?? `Tool ${tool.name}`}`,
            parameters: tool.inputSchema as Record<string, unknown>,
          },
          enabled: (opts) => opts.trusted && definition.enabled(),
          handler: async (_logger, args) => {
            try {
              const result = await client.callTool({ name: tool.name, arguments: args }, { toolDefinition: tool });
              return toToolResult(definition.name, exposedName, result);
            } catch (error) {
              // Thrown (vs. `isError`) means the request itself failed:
              // network, session, or protocol — a Koris-side problem.
              const message = describeError(error);
              this.logger.warn(`[mcp] Request to "${definition.name}" failed`, { tool: tool.name, error: message });
              return {
                toolName: exposedName,
                success: false,
                error: `MCP request to "${definition.name}" failed: ${message}`,
              };
            }
          },
        };
        active.disposers.push(this.registry.extend(COMMANDS, adapted));
      } catch (error) {
        this.logger.warn(`[mcp] Skipping invalid tool "${tool.name}" from "${definition.name}"`, {
          error: describeError(error),
        });
      }
    }
    this.statuses.set(definition.name, {
      name: definition.name,
      state: 'connected',
      toolCount: active.disposers.length,
    });
    this.publishTools();
  }

  private publishTools(): void {
    ToolPluginsSingleton.replace(this.registry.collect(COMMANDS));
  }
}

export class McpManagerSingleton {
  private static instance: McpManager | null = null;

  static getInstance(
    logger: ILogger,
    registry: PluginRegistry,
    definitions: McpServerDefinition[],
  ): McpManager {
    if (!this.instance) this.instance = new McpManager(logger, registry, definitions);
    return this.instance;
  }

  static getExistingInstance(): McpManager | null {
    return this.instance;
  }
}

export { describeError, exposedToolName, serializeResult, validatedUrl };
