import { watch, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import type { ILogger } from '../../infrastructure/logger';
import type { ToolPluginContext } from '../../../../plugins/tools/contracts';
import { COMMANDS } from '../../../../plugins/tools/contracts';
import type { Plugin, PluginRegistry } from '../../../../plugins/registry';
import { ToolPluginsSingleton } from './registry-singleton';
import { PluginCatalogSingleton } from '../plugins/plugin-catalog-singleton';
import { DirectoryWatcher } from '../plugins/directory-watcher';
import { loadPluginModule } from '../plugins/module-loader';

interface ToolModule {
  create?(context?: ToolPluginContext): Plugin | null;
}

export interface ToolSyncOptions {
  /** Where new tool source lands — `config.BASE_DIR/plugins/tools` (what `pnpm hub:pull` writes into). */
  sourceDir: string;
  /** Where the live loader `require()`s tools from — `plugins/tools`'s own compiled `__dirname` (`TOOLS_DIR`). */
  distDir: string;
  context: ToolPluginContext;
  registry: PluginRegistry;
  requireModule?: (modulePath: string) => ToolModule;
  transpile?: (source: string, filename: string) => string;
}

/**
 * Watches `plugins/tools/` for tool folders that appear after boot (e.g. from
 * `pnpm hub:pull`, or a UI marketplace pull hitting the exact same directory)
 * and loads them into the *live* process without a rebuild or restart.
 */
class ToolSyncService {
  private readonly watcher: DirectoryWatcher;
  private readonly knownSlugs: Set<string>;

  constructor(
    private readonly logger: ILogger,
    private readonly options: ToolSyncOptions,
    knownSlugs: string[],
  ) {
    this.knownSlugs = new Set(knownSlugs);
    this.watcher = new DirectoryWatcher({
      root: () => options.sourceDir,
      directories: () => readdirSync(options.sourceDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory()).map((entry) => entry.name),
      watch,
      onChange: () => this.sync(),
      onError: (error) => logger.warn('[tool-sync] Failed to watch or sync tools directory', {
        error: error instanceof Error ? error.message : String(error),
      }),
    });
  }

  start(): void {
    mkdirSync(this.options.sourceDir, { recursive: true });
    // Catches a tool pulled while the process was down — otherwise its folder
    // would just sit there until some unrelated fs event on sourceDir happens
    // to trigger the watcher below.
    this.sync();
    this.watcher.start();
    this.logger.info('[tool-sync] Watching tools directory for newly pulled plugins');
  }

  stop(): void {
    this.watcher.stop();
  }

  sync(forcedSlug?: string): void {
    if (forcedSlug) {
      this.knownSlugs.delete(forcedSlug);
    }

    let entries;
    try {
      entries = readdirSync(this.options.sourceDir, { withFileTypes: true });
    } catch {
      return;
    }

    const candidates = entries
      .filter((entry) => entry.isDirectory() && !this.knownSlugs.has(entry.name))
      .map((entry) => entry.name);
    const loaded: string[] = [];
    for (const slug of candidates) {
      try {
        if (loadPluginModule(slug, {
          ...this.options,
          fileSystem: { readdirSync, mkdirSync, readFileSync, writeFileSync },
        })) {
          this.knownSlugs.add(slug);
          loaded.push(slug);
        }
      } catch (error) {
        this.knownSlugs.add(slug);
        this.logger.warn(`[tool-sync] Failed to hot-load tool "${slug}"`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.watcher.refresh();

    if (loaded.length === 0) return;

    ToolPluginsSingleton.replace(this.options.registry.collect(COMMANDS));
    PluginCatalogSingleton.append(loaded.map((name) => ({ family: 'tools' as const, name })));
    this.logger.info(`[tool-sync] Hot-loaded ${loaded.length} new tool(s): ${loaded.join(', ')}`);
  }
}

class ToolSyncSingleton {
  private static instance: ToolSyncService | null = null;

  static getInstance(logger: ILogger, options: ToolSyncOptions, knownSlugs: string[]): ToolSyncService {
    if (!ToolSyncSingleton.instance) {
      ToolSyncSingleton.instance = new ToolSyncService(logger, options, knownSlugs);
    }
    return ToolSyncSingleton.instance;
  }

  static getExistingInstance(): ToolSyncService | null {
    return ToolSyncSingleton.instance;
  }
}

export { ToolSyncService, ToolSyncSingleton };
