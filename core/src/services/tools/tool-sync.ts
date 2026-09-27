import { watch, type FSWatcher, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'node:path';
import { transformSync } from 'esbuild';
import type { ILogger } from '../../infrastructure/logger';
import type { ToolPluginContext } from '../../../../plugins/tools/contracts';
import { COMMANDS } from '../../../../plugins/tools/contracts';
import type { Plugin, PluginRegistry } from '../../../../plugins/registry';
import { ToolPluginsSingleton } from './registry-singleton';
import { PluginCatalogSingleton } from '../plugins/plugin-catalog-singleton';

const DEBOUNCE_MS = 500;

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
  private watchers: FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly knownSlugs: Set<string>;
  private readonly requireModule: (modulePath: string) => ToolModule;
  private readonly transpile: (source: string, filename: string) => string;

  constructor(
    private readonly logger: ILogger,
    private readonly options: ToolSyncOptions,
    knownSlugs: string[],
  ) {
    this.knownSlugs = new Set(knownSlugs);
    this.requireModule = options.requireModule ?? ((modulePath) => require(modulePath) as ToolModule);
    this.transpile = options.transpile ?? ((source, filename) =>
      transformSync(source, { loader: 'ts', format: 'cjs', sourcefile: filename }).code);
  }

  start(): void {
    mkdirSync(this.options.sourceDir, { recursive: true });
    // Catches a tool pulled while the process was down — otherwise its folder
    // would just sit there until some unrelated fs event on sourceDir happens
    // to trigger the watcher below.
    this.sync();
    this.registerWatchers();
    this.logger.info('[tool-sync] Watching tools directory for newly pulled plugins');
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.closeWatchers();
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
    if (candidates.length === 0) return;

    const loaded: string[] = [];
    for (const slug of candidates) {
      try {
        if (this.loadTool(slug)) {
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

    if (this.watchers.length > 0) {
      this.registerWatchers();
    }

    if (loaded.length === 0) return;

    ToolPluginsSingleton.replace(this.options.registry.collect(COMMANDS));
    PluginCatalogSingleton.append(loaded.map((name) => ({ family: 'tools' as const, name })));
    this.logger.info(`[tool-sync] Hot-loaded ${loaded.length} new tool(s): ${loaded.join(', ')}`);
  }

  private loadTool(slug: string): boolean {
    const sourceTool = path.join(this.options.sourceDir, slug);
    const distTool = path.join(this.options.distDir, slug);

    let entries;
    try {
      entries = readdirSync(sourceTool, { withFileTypes: true });
    } catch {
      return false;
    }

    const sourceFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'));
    if (sourceFiles.length === 0) return false;

    // A tool module must have an index.ts to be require-able
    if (!sourceFiles.some((entry) => entry.name === 'index.ts')) return false;

    mkdirSync(distTool, { recursive: true });
    for (const file of sourceFiles) {
      const sourcePath = path.join(sourceTool, file.name);
      const source = readFileSync(sourcePath, 'utf-8');
      const code = this.transpile(source, sourcePath);
      writeFileSync(path.join(distTool, file.name.replace(/\.ts$/, '.js')), code, 'utf-8');
    }

    // Invalidate require cache for distTool and all its transpiled outputs
    try {
      const resolved = require.resolve(distTool);
      delete require.cache[resolved];
    } catch {}
    for (const file of sourceFiles) {
      const jsPath = path.join(distTool, file.name.replace(/\.ts$/, '.js'));
      try {
        const resolved = require.resolve(jsPath);
        delete require.cache[resolved];
      } catch {}
    }

    const mod = this.requireModule(distTool);
    if (typeof mod.create !== 'function') return false;

    const plugin = mod.create(this.options.context);
    if (!plugin) return false;

    plugin.setup(this.options.registry);
    return true;
  }

  private registerWatchers(): void {
    this.closeWatchers();

    try {
      this.watchers.push(
        watch(this.options.sourceDir, { persistent: true }, () => this.scheduleSync()),
      );

      let entries;
      try {
        entries = readdirSync(this.options.sourceDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            this.watchers.push(
              watch(path.join(this.options.sourceDir, entry.name), { persistent: true }, () => this.scheduleSync()),
            );
          } catch {
            // best-effort per subfolder
          }
        }
      }
    } catch (error) {
      this.logger.warn('[tool-sync] Failed to watch tools directory', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private closeWatchers(): void {
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {}
    }
    this.watchers = [];
  }

  private scheduleSync(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.sync(), DEBOUNCE_MS);
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
