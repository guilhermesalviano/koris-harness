import { config } from '../../config';
import { ToolPluginsSingleton } from '../tools/registry-singleton';
import { ToolSyncSingleton } from '../tools/tool-sync';
import { listMissing, pullEntry } from '../../../../scripts/hub-sync';
import type { CommandContext, CommandResult } from '../../types/commands';
import { formatCommandResult } from './format';

export interface ToolCommandSummary {
  name: string;
  description: string;
}

export function listTools(): ToolCommandSummary[] {
  return ToolPluginsSingleton.getExistingInstance()
    .filter((def) => def.enabled({ trusted: true }))
    .map((def) => ({
      name: def.name,
      description: def.schema.description,
    }));
}

export async function handleToolsCommand(command: string, context: CommandContext): Promise<CommandResult> {
  if (context.trusted === false) {
    return formatCommandResult('Tools are only available to trusted senders.', context.source);
  }

  const rawArgs = command.trim().split(/\s+/).slice(1);
  const sub = rawArgs[0]?.toLowerCase();

  const isRemote = sub === 'remote' || sub === 'available' || (sub === 'list' && rawArgs[1]?.toLowerCase() === 'remote');
  const isLocal = !sub || sub === 'local' || (sub === 'list' && rawArgs[1]?.toLowerCase() !== 'remote');
  const isDownload = sub === 'download' || sub === 'pull' || sub === 'install';

  if (isLocal) {
    const tools = listTools();
    if (tools.length === 0) {
      return formatCommandResult('No tools are loaded.', context.source);
    }

    const rows = tools.map((tool) => `  ${tool.name.padEnd(24)} ${tool.description}`);
    const message = `*Tools* (${tools.length})\n\n${rows.join('\n')}\n\nThese tools are available for me to use during conversations.\nUse \`/tools remote\` to see tools available for download.`;
    return formatCommandResult(message, context.source);
  }

  if (isRemote) {
    try {
      const missing = await listMissing({ baseDir: config.BASE_DIR });
      const tools = missing.filter((item) => item.family === 'tool');

      if (tools.length === 0) {
        return formatCommandResult(
          'No new remote tools available in koris-hub. All tools are already installed.',
          context.source,
        );
      }

      const rows = tools.map((tool) => `  ${tool.slug.padEnd(24)} ${tool.summary ?? ''}`.trimEnd());
      const message = `*Available Remote Tools* (${tools.length})\n\n${rows.join('\n')}\n\nUse \`/tools download <name>\` to download and install a tool.`;
      return formatCommandResult(message, context.source);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return formatCommandResult(`Failed to reach koris-hub: ${errorMsg}`, context.source);
    }
  }

  if (isDownload) {
    const remaining = rawArgs.slice(1);
    const force = remaining.includes('--force');
    const slug = remaining.find((arg) => arg !== '--force')?.toLowerCase();

    if (!slug) {
      return formatCommandResult(
        'Missing tool name.\n\nUsage: /tools download <name> [--force]\nUse `/tools remote` to see available tools.',
        context.source,
      );
    }

    try {
      await pullEntry(slug, { baseDir: config.BASE_DIR, family: 'tool', force });
      ToolSyncSingleton.getExistingInstance()?.sync(slug);
      return formatCommandResult(
        `Successfully downloaded tool "${slug}". It is loaded and ready to use.`,
        context.source,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return formatCommandResult(`Failed to download tool "${slug}": ${errorMsg}`, context.source);
    }
  }

  return formatCommandResult(
    'Usage: /tools [remote | download <name> [--force]]\n\n' +
    '  /tools                   — List loaded tools\n' +
    '  /tools remote            — List available tools in koris-hub\n' +
    '  /tools download <name>   — Download a tool from koris-hub',
    context.source,
  );
}
