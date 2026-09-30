import { watch, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { ILogger } from '../../infrastructure/logger';
import type { McpPluginContext } from '../../../../plugins/mcps/contracts';
import { MCP_SERVERS } from '../../../../plugins/mcps/contracts';
import type { McpPluginModule } from '../../../../plugins/mcps';
import type { PluginRegistry } from '../../../../plugins/registry';
import type { IPluginSettingsRepository } from '../../repositories/plugin-settings';
import { PluginCatalogSingleton } from '../plugins/plugin-catalog-singleton';
import type { McpManager } from './mcp-manager';
import { DirectoryWatcher } from '../plugins/directory-watcher';
import { loadPluginModule } from '../plugins/module-loader';

export interface McpSyncOptions {
  sourceDir: string;
  distDir: string;
  context: McpPluginContext;
  registry: PluginRegistry;
  manager: Pick<McpManager, 'addDefinitions'>;
  pluginSettings: Pick<IPluginSettingsRepository, 'getEnabled' | 'setEnabled'>;
  requireModule?: (modulePath: string) => McpPluginModule;
  transpile?: (source: string, filename: string) => string;
}

export class McpSyncService {
  private readonly watcher: DirectoryWatcher;
  private readonly knownSlugs: Set<string>;

  constructor(
    private readonly logger: ILogger,
    private readonly options: McpSyncOptions,
    knownSlugs: string[],
  ) {
    this.knownSlugs = new Set(knownSlugs);
    this.watcher = new DirectoryWatcher({
      root: () => options.sourceDir,
      directories: () => readdirSync(options.sourceDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !this.knownSlugs.has(entry.name))
        .map((entry) => entry.name),
      watch,
      onChange: () => this.sync(),
      onError: (error) => logger.warn('[mcp-sync] Failed to watch or sync MCP directory', {
        error: error instanceof Error ? error.message : String(error),
      }),
    });
  }

  start(): void {
    mkdirSync(this.options.sourceDir, { recursive: true });
    this.watcher.start();
    void this.sync().catch((error) => this.logger.warn('[mcp-sync] Initial sync failed', {
      error: error instanceof Error ? error.message : String(error),
    }));
    this.logger.info('[mcp-sync] Watching MCP directory for newly pulled plugins');
  }

  stop(): void {
    this.watcher.stop();
  }

  async sync(forcedSlug?: string): Promise<void> {
    if (forcedSlug) this.knownSlugs.delete(forcedSlug);
    let entries;
    try {
      entries = readdirSync(this.options.sourceDir, { withFileTypes: true });
    } catch {
      return;
    }
    const candidates = entries.filter((entry) => entry.isDirectory() && !this.knownSlugs.has(entry.name));
    const loaded: string[] = [];
    for (const entry of candidates) {
      // A folder without index.ts yet (a pull still writing files) stays
      // unknown so the per-folder watcher retries it once the files land.
      try {
        if (loadPluginModule(entry.name, {
          ...this.options,
          fileSystem: { readdirSync, mkdirSync, readFileSync, writeFileSync },
        })) {
          this.knownSlugs.add(entry.name);
          loaded.push(entry.name);
        }
      } catch (error) {
        this.knownSlugs.add(entry.name);
        this.logger.warn(`[mcp-sync] Failed to hot-load "${entry.name}"`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.watcher.refresh();
    if (loaded.length === 0) return;
    // A freshly downloaded server starts enabled; an existing row (the user's
    // explicit choice) wins. Seeded before `addDefinitions` so it connects now.
    for (const slug of loaded) {
      if (this.options.pluginSettings.getEnabled('mcps', slug) !== null) continue;
      this.options.pluginSettings.setEnabled('mcps', slug, true);
      this.logger.info(`[mcp-sync] Enabled newly downloaded MCP plugin "${slug}"`);
    }
    const definitions = this.options.registry.collect(MCP_SERVERS);
    await this.options.manager.addDefinitions(definitions);
    PluginCatalogSingleton.append(loaded.map((name) => ({ family: 'mcps' as const, name })));
    this.logger.info(`[mcp-sync] Hot-loaded ${loaded.length} MCP plugin(s): ${loaded.join(', ')}`);
  }
}

export class McpSyncSingleton {
  private static instance: McpSyncService | null = null;

  static getInstance(logger: ILogger, options: McpSyncOptions, knownSlugs: string[]): McpSyncService {
    if (!this.instance) this.instance = new McpSyncService(logger, options, knownSlugs);
    return this.instance;
  }

  static getExistingInstance(): McpSyncService | null {
    return this.instance;
  }
}
