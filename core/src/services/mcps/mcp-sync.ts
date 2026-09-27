import { watch, type FSWatcher, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';
import type { ILogger } from '../../infrastructure/logger';
import type { McpPluginContext } from '../../../../plugins/mcps/contracts';
import { MCP_SERVERS } from '../../../../plugins/mcps/contracts';
import type { McpPluginModule } from '../../../../plugins/mcps';
import type { PluginRegistry } from '../../../../plugins/registry';
import type { IPluginSettingsRepository } from '../../repositories/plugin-settings';
import { PluginCatalogSingleton } from '../plugins/plugin-catalog-singleton';
import type { McpManager } from './mcp-manager';

const DEBOUNCE_MS = 500;

export interface McpSyncOptions {
  sourceDir: string;
  distDir: string;
  context: McpPluginContext;
  registry: PluginRegistry;
  manager: McpManager;
  pluginSettings: Pick<IPluginSettingsRepository, 'getEnabled' | 'setEnabled'>;
  requireModule?: (modulePath: string) => McpPluginModule;
  transpile?: (source: string, filename: string) => string;
}

export class McpSyncService {
  private watchers: FSWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly knownSlugs: Set<string>;

  constructor(
    private readonly logger: ILogger,
    private readonly options: McpSyncOptions,
    knownSlugs: string[],
  ) {
    this.knownSlugs = new Set(knownSlugs);
  }

  start(): void {
    mkdirSync(this.options.sourceDir, { recursive: true });
    void this.sync();
    this.registerWatcher();
    this.logger.info('[mcp-sync] Watching MCP directory for newly pulled plugins');
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.closeWatchers();
  }

  private closeWatchers(): void {
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {}
    }
    this.watchers = [];
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
        if (this.load(entry.name)) {
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
    if (this.watchers.length > 0) this.registerWatcher();
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

  private load(slug: string): boolean {
    const sourceDir = path.join(this.options.sourceDir, slug);
    const distDir = path.join(this.options.distDir, slug);
    const files = readdirSync(sourceDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'));
    if (!files.some((entry) => entry.name === 'index.ts')) return false;
    mkdirSync(distDir, { recursive: true });
    const transpile = this.options.transpile ?? ((source: string, filename: string) =>
      transformSync(source, { loader: 'ts', format: 'cjs', sourcefile: filename }).code);
    for (const file of files) {
      const sourcePath = path.join(sourceDir, file.name);
      writeFileSync(
        path.join(distDir, file.name.replace(/\.ts$/, '.js')),
        transpile(readFileSync(sourcePath, 'utf-8'), sourcePath),
        'utf-8',
      );
    }
    // Drop every transpiled file from the require cache, not just index.js —
    // a `--force` re-pull must not keep serving a stale config.js.
    for (const modulePath of [distDir, ...files.map((file) => path.join(distDir, file.name.replace(/\.ts$/, '.js')))]) {
      try {
        delete require.cache[require.resolve(modulePath)];
      } catch {}
    }
    const loadModule = this.options.requireModule ?? ((modulePath: string) => require(modulePath) as McpPluginModule);
    const mod = loadModule(distDir);
    if (typeof mod.create !== 'function') return false;
    const plugin = mod.create(this.options.context);
    if (!plugin) return false;
    plugin.setup(this.options.registry);
    return true;
  }

  /**
   * Watches the MCP root plus each plugin folder: a non-recursive watch on the
   * root alone misses files written into a folder after it was created.
   */
  private registerWatcher(): void {
    this.closeWatchers();
    const scheduleSync = () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.sync(), DEBOUNCE_MS);
    };
    try {
      this.watchers.push(watch(this.options.sourceDir, { persistent: true }, scheduleSync));
      for (const entry of readdirSync(this.options.sourceDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || this.knownSlugs.has(entry.name)) continue;
        try {
          this.watchers.push(watch(path.join(this.options.sourceDir, entry.name), { persistent: true }, scheduleSync));
        } catch {
          // best-effort per folder
        }
      }
    } catch (error) {
      this.logger.warn('[mcp-sync] Failed to watch MCP directory', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
