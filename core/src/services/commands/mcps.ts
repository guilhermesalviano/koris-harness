import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../../config';
import { DatabaseServiceFactory } from '../../infrastructure/db-sqlite';
import { PluginSettingsRepositoryFactory } from '../../repositories/plugin-settings';
import { McpManagerSingleton } from '../mcps/mcp-manager';
import { McpSyncSingleton } from '../mcps/mcp-sync';
import { PluginCatalogSingleton } from '../plugins/plugin-catalog-singleton';
import { resolvePluginEnabled } from '../plugins/plugin-enablement';
import { listMissing, pullEntry } from '../../../../scripts/hub-sync';
import type { CommandContext, CommandResult } from '../../types/commands';
import { formatCommandResult } from './format';

export function listInstalledMcpNames(baseDir: string = config.BASE_DIR): string[] {
  const directory = path.join(baseDir, 'plugins', 'mcps');
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export async function handleMcpsCommand(command: string, context: CommandContext): Promise<CommandResult> {
  if (context.trusted === false) return formatCommandResult('MCP servers are only available to trusted senders.', context.source);
  const args = command.trim().split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();

  if (!sub || sub === 'local' || sub === 'list') {
    const names = listInstalledMcpNames();
    if (names.length === 0) return formatCommandResult('No MCP servers are installed. Use `/mcps remote` to see available servers.', context.source);
    const statuses = new Map((McpManagerSingleton.getExistingInstance()?.getStatuses() ?? []).map((status) => [status.name, status]));
    const repo = PluginSettingsRepositoryFactory.create(DatabaseServiceFactory.create());
    const rows = names.map((name) => {
      const enabled = resolvePluginEnabled(repo, 'mcps', name);
      const status = statuses.get(name);
      const detail = status?.state === 'connected' ? `${status.state}, ${status.toolCount} tools` : status?.state ?? 'not loaded';
      return `  ${name.padEnd(24)} [${enabled ? 'enabled' : 'disabled'}, ${detail}]`;
    });
    return formatCommandResult(`*MCP Servers* (${names.length})\n\n${rows.join('\n')}`, context.source);
  }

  if (sub === 'remote' || sub === 'available') {
    try {
      const entries = (await listMissing({ baseDir: config.BASE_DIR })).filter((item) => item.family === 'mcp');
      if (entries.length === 0) return formatCommandResult('No new remote MCP servers are available.', context.source);
      return formatCommandResult(`*Available Remote MCP Servers*\n\n${entries.map((item) => `  ${item.slug.padEnd(24)} ${item.summary ?? ''}`.trimEnd()).join('\n')}`, context.source);
    } catch (error) {
      return formatCommandResult(`Failed to reach koris-hub: ${error instanceof Error ? error.message : String(error)}`, context.source);
    }
  }

  if (sub === 'download' || sub === 'pull' || sub === 'install') {
    const force = args.includes('--force');
    const slug = args.slice(1).find((arg) => arg !== '--force')?.toLowerCase();
    if (!slug) return formatCommandResult('Usage: /mcps download <name> [--force]', context.source);
    try {
      await pullEntry(slug, { baseDir: config.BASE_DIR, family: 'mcp', force });
      await McpSyncSingleton.getExistingInstance()?.sync(slug);
      const status = McpManagerSingleton.getExistingInstance()?.getStatuses().find((item) => item.name === slug);
      if (status?.state === 'connected') {
        return formatCommandResult(`Downloaded and enabled MCP server "${slug}" (${status.toolCount} tools).`, context.source);
      }
      if (status?.state === 'error') {
        return formatCommandResult(
          `Downloaded and enabled MCP server "${slug}", but it failed to connect: ${status.error ?? 'unknown error'}. Set its URL/token in Configuration → Plugins.`,
          context.source,
        );
      }
      if (status?.state === 'disabled') {
        return formatCommandResult(`Downloaded MCP server "${slug}". It stays disabled as you set it — use \`/mcps enable ${slug}\` to turn it on.`, context.source);
      }
      return formatCommandResult(`Downloaded MCP server "${slug}".`, context.source);
    } catch (error) {
      return formatCommandResult(`Failed to download MCP server "${slug}": ${error instanceof Error ? error.message : String(error)}`, context.source);
    }
  }

  if (sub === 'enable' || sub === 'disable') {
    const name = args[1]?.toLowerCase();
    if (!name) return formatCommandResult(`Usage: /mcps ${sub} <name>`, context.source);
    if (!listInstalledMcpNames().includes(name)) return formatCommandResult(`MCP server "${name}" is not installed.`, context.source);
    const enabled = sub === 'enable';
    const repo = PluginSettingsRepositoryFactory.create(DatabaseServiceFactory.create());
    repo.setEnabled('mcps', name, enabled);
    PluginCatalogSingleton.append([{ family: 'mcps', name }]);
    const manager = McpManagerSingleton.getExistingInstance();
    const connected = enabled ? await manager?.enable(name) : await manager?.disable(name);
    if (enabled && connected === false) {
      return formatCommandResult(`MCP server "${name}" is enabled but failed to connect. Toggle it to retry after checking its configuration.`, context.source);
    }
    return formatCommandResult(`MCP server "${name}" is now ${enabled ? 'enabled' : 'disabled'}.`, context.source);
  }

  return formatCommandResult(
    'Usage: /mcps [remote | download <name> [--force] | enable <name> | disable <name>]',
    context.source,
  );
}
