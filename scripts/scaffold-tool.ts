import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Generates a new `plugins/tools/<name>/` plugin folder from a template.
 * This is the single template-writing implementation — both the dev CLI
 * (`scripts/scaffold-tool-cli.ts`) and the chat-callable `create_tool` tool
 * (`plugins/tools/create-tool/`) call into this function rather than
 * duplicating the templates.
 */

export interface ScaffoldParameterSpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
}

export interface ScaffoldToolInput {
  /** kebab-case plugin folder name, e.g. "weather-lookup". */
  name: string;
  /** LLM-facing tool name. Defaults to `name` with hyphens replaced by underscores. */
  toolName?: string;
  description: string;
  parameters?: ScaffoldParameterSpec[];
}

export interface ScaffoldFileIO {
  exists(targetPath: string): boolean;
  mkdir(targetPath: string): void;
  writeFile(targetPath: string, content: string): void;
}

export interface ScaffoldOptions {
  /** The `plugins/tools/` directory new plugins are written under. */
  baseDir?: string;
  io?: ScaffoldFileIO;
}

export interface ScaffoldResult {
  pluginName: string;
  toolName: string;
  /** Paths relative to `plugins/tools/`. */
  createdFiles: string[];
}

const defaultFileIO: ScaffoldFileIO = {
  exists: existsSync,
  mkdir: (targetPath) => mkdirSync(targetPath, { recursive: true }),
  writeFile: (targetPath, content) => writeFileSync(targetPath, content, 'utf-8'),
};

// Strict kebab-case: lowercase, no leading/trailing/consecutive hyphens, no
// path separators or dots — rejected outright, never slugified/auto-fixed.
// Also reused by scripts/hub-sync.ts, since a koris-hub slug becomes a local
// plugin folder name under the same rule.
export const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function toPascalCase(kebab: string): string {
  return kebab.split('-').map((part) => part[0]!.toUpperCase() + part.slice(1)).join('');
}

function buildParametersBlock(parameters: ScaffoldParameterSpec[]): string {
  if (parameters.length === 0) return '';

  const entries = parameters
    .map((p) => {
      const requiredLine = p.required ? `\n        required: true,` : '';
      return `      ${p.name}: {\n        type: '${p.type}',${requiredLine}\n        description: ${JSON.stringify(p.description)},\n      },`;
    })
    .join('\n');

  return `\n    parameters: {\n${entries}\n    },`;
}

function buildIndexFile(input: ScaffoldToolInput, toolName: string, pluginClassName: string): string {
  return `import type { ILogger, Plugin, ToolPluginContext, ToolResult } from '../contracts';
import { COMMANDS } from '../contracts';
import { defineTool } from '../define-tool';

export const TOOL_NAME = '${toolName}' as const;

// TODO: implement the actual tool logic. args are whatever the LLM passed,
// matching the "parameters" spec below.
export async function execute${pluginClassName}(
  logger: ILogger,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  logger.info('${toolName} called', { args });
  return {
    toolName: TOOL_NAME,
    success: false,
    error: 'TODO: ${toolName} is not implemented yet.',
  };
}

export function create(context: ToolPluginContext): Plugin {
  return {
    name: '${input.name}',
    setup(registry) {
      const definition = defineTool({
        name: TOOL_NAME,
        description: ${JSON.stringify(input.description)},${buildParametersBlock(input.parameters ?? [])}
        handler: (logger, args) => execute${pluginClassName}(logger, args),
        enabled: (opts) => opts.trusted && context.pluginEnablement.isEnabled('${input.name}'),
      });
      registry.extend(COMMANDS, definition);
    },
  };
}
`;
}

function buildTestFile(pluginClassName: string): string {
  return `import { describe, it, expect, vi } from 'vitest';
import { execute${pluginClassName} } from './index';

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };

describe('${pluginClassName}', () => {
  it('is scaffolded but not implemented yet', async () => {
    const result = await execute${pluginClassName}(logger, {});
    expect(result.success).toBe(false);
  });
});
`;
}

export function scaffoldToolPlugin(input: ScaffoldToolInput, options: ScaffoldOptions = {}): ScaffoldResult {
  if (!NAME_PATTERN.test(input.name)) {
    throw new Error(
      `Invalid tool plugin name "${input.name}": must be lowercase kebab-case (e.g. "weather-lookup"), ` +
      'no leading/trailing/consecutive hyphens, no path separators.',
    );
  }

  const baseDir = path.resolve(options.baseDir ?? path.join(__dirname, '..', 'plugins', 'tools'));
  const io = options.io ?? defaultFileIO;

  const target = path.join(baseDir, input.name);
  // Defense in depth beyond NAME_PATTERN: the resolved target must stay
  // strictly inside baseDir — never derived from unsanitized input alone.
  if (!(target + path.sep).startsWith(baseDir + path.sep) && target !== baseDir) {
    throw new Error('Refusing to write outside the tools plugin directory.');
  }
  if (io.exists(target)) {
    throw new Error(`A tool plugin named "${input.name}" already exists at ${target}.`);
  }

  const toolName = input.toolName ?? input.name.replace(/-/g, '_');
  const pluginClassName = toPascalCase(input.name);

  io.mkdir(target);

  const createdFiles: string[] = [];
  const write = (filename: string, content: string): void => {
    io.writeFile(path.join(target, filename), content);
    createdFiles.push(path.join(input.name, filename));
  };

  write('index.ts', buildIndexFile(input, toolName, pluginClassName));
  write('index.test.ts', buildTestFile(pluginClassName));

  return { pluginName: input.name, toolName, createdFiles };
}
