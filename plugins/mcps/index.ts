import * as fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from '../registry';
import type { McpPluginContext } from './contracts';

type PluginDirectoryEntry = Pick<fs.Dirent, 'name' | 'isDirectory'>;

export interface McpPluginModule {
  create?(context?: McpPluginContext): Plugin | null;
}

export interface CreateMcpPluginsOptions {
  directory?: string;
  readdirSync?: (directory: string, options: { withFileTypes: true }) => PluginDirectoryEntry[];
  loadModule?: (modulePath: string) => McpPluginModule;
  onLoadError?: (server: string, error: unknown) => void;
  context?: McpPluginContext;
}

function warnLoadFailure(server: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[mcps] "${server}" was skipped - its plugin failed to load: ${message}`);
}

export function createMcpPlugins(options: CreateMcpPluginsOptions = {}): Plugin[] {
  const {
    directory = __dirname,
    readdirSync = fs.readdirSync as CreateMcpPluginsOptions['readdirSync'],
    loadModule = (modulePath: string) => require(modulePath) as McpPluginModule,
    onLoadError = warnLoadFailure,
    context,
  } = options;

  if (!fs.existsSync(directory)) return [];

  return readdirSync!(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        const mod = loadModule(path.join(directory, entry.name));
        if (typeof mod.create !== 'function') return [];
        const plugin = mod.create(context);
        return plugin ? [plugin] : [];
      } catch (error) {
        onLoadError(entry.name, error);
        return [];
      }
    });
}

export const MCPS_DIR = __dirname;
export { buildRegistry, PluginRegistry } from '../registry';
export type { Plugin };
