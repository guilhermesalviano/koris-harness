import { ExtensionPoint } from '../registry';

export const COMMANDS = new ExtensionPoint<ToolDefinition>('tools.commands');

export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

/** Copied from `plugins/channels/contracts.ts` — same shape, not imported, so no plugin family depends on another. */
export interface StickerReference {
  key: {
    remoteJid: string;
    id?: string;
    participant?: string;
    fromMe: boolean;
  };
  message: unknown;
  mimeType?: string;
}

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  result?: string;
  error?: string;
  toolCallId?: string;
  /**
   * Set on a successful result when the tool's user-facing effect is already fully
   * delivered by the tool itself. The executor loop skips its post-tool synthesis
   * call entirely when every result in a batch is silent and successful.
   */
  silent?: boolean;
}

export interface ToolExecutionContext {
  channel?: string;
  sessionId?: string;
  runId?: string;
  agentName?: string;
  stickers?: StickerReference[];
  target?: string;
}

export type ToolHandler = (
  logger: ILogger,
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
) => Promise<ToolResult>;

export interface ToolFilterOptions {
  /** Replaces the old global `toolsEnabled` trust-based kill switch. */
  trusted: boolean;
  /** Replaces `includeBeatTools` — e.g. the heartbeat sub-agent sets this to `'heartbeat'` to exclude beat tools and avoid recursive scheduling. */
  agentName?: string;
}

export interface ToolSchema {
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolDefinition {
  /** The LLM-facing tool name, e.g. 'search_engine'. Single source of truth — see each plugin's `TOOL_NAME` constant. */
  name: string;
  schema: ToolSchema;
  handler: ToolHandler;
  enabled: (opts: ToolFilterOptions) => boolean;
}

// --- Narrow, per-concern gateways injected via ToolPluginContext ---
// Each is a purpose-built interface (ISP) over a real core service/repository,
// adapted by core/src/app.ts's createToolPluginContext() — the composition root.
// Tool plugins never import core/src/ directly, mirroring plugins/channels/.

export interface HeartbeatRecord {
  id: string;
  beat: string;
  type: string;
  cronExpression: string;
  channel?: string;
  target?: string;
  lastRun?: Date;
  managed?: boolean;
  runOnce?: boolean;
  createdAt: Date;
}

export interface CreateHeartbeatInput {
  beat: string;
  type: string;
  cronExpression: string;
  channel?: string;
  target?: string;
  /** Delete the beat after it fires once instead of repeating on every cron match. */
  runOnce?: boolean;
}

export interface UpdateHeartbeatInput {
  beat?: string;
  type?: string;
  cronExpression?: string;
  channel?: string | null;
  target?: string | null;
  runOnce?: boolean;
}

export interface IHeartbeatGateway {
  create(input: CreateHeartbeatInput): HeartbeatRecord;
  getById(id: string): HeartbeatRecord | null;
  getAll(): HeartbeatRecord[];
  update(id: string, input: UpdateHeartbeatInput): HeartbeatRecord | null;
  deleteById(id: string): boolean;
  /** Reschedules the running cron scheduler after a save/update/delete — a no-op if it isn't running yet. */
  reschedule(): void;
}

export interface OutboundMessageRecord {
  id: string;
  channel: string;
  target: string;
  status: string;
  errorMessage?: string;
}

export interface IChannelsGateway {
  /** Throws if no channel manager is currently running. */
  sendMessage(channel: string, target: string, content: string): Promise<OutboundMessageRecord>;
  /** Throws if no channel manager is currently running. */
  sendSticker(channel: string, target: string, sticker: StickerReference): Promise<void>;
}

export interface StickerRuleRecord {
  id: string;
  description: string;
  reference: StickerReference;
  channel: string;
}

export interface SaveStickerRuleInput {
  description: string;
  reference: StickerReference;
  channel: string;
}

export interface IStickerRulesGateway {
  save(input: SaveStickerRuleInput): StickerRuleRecord;
  getById(id: string): StickerRuleRecord | null;
  deleteById(id: string): boolean;
}

export interface ToolPluginConfigValues {
  searxngUrl: string;
  allowedDomains: string[];
  githubOwner: string;
  githubToken: string;
}

/** Copied from `plugins/channels/contracts.ts` — same shape, not imported, so no plugin family depends on another. */
export interface IPluginEnablementGateway {
  isEnabled(name: string): boolean;
}

export interface ToolPluginContext {
  logger: ILogger;
  heartbeats: IHeartbeatGateway;
  channels: IChannelsGateway;
  stickerRules: IStickerRulesGateway;
  security: {
    /** gateErrorForUrl — returns an error message when the URL's host isn't allowlisted, or null when it's OK. */
    gateUrl: (url: string) => string | null;
  };
  config: ToolPluginConfigValues;
  pluginEnablement: IPluginEnablementGateway;
}

export { ExtensionPoint };
export type { Plugin, PluginRegistry } from '../registry';
