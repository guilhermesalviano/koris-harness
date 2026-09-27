import * as fs from 'node:fs';
import path from 'node:path';
import { PluginRegistry, buildRegistry, type Plugin } from '../registry';
import type { PluginContext, LiveChannelDescriptor } from './contracts';

type PluginDirectoryEntry = Pick<fs.Dirent, 'name' | 'isDirectory'>;

interface PluginModule {
  create?(context?: PluginContext): Plugin | null;
  liveChannel?: LiveChannelDescriptor;
}

interface CreatePluginsOptions {
  directory?: string;
  readdirSync?: (directory: string, options: { withFileTypes: true }) => PluginDirectoryEntry[];
  loadModule?: (modulePath: string) => PluginModule;
  /**
   * Called when a channel folder is present but its module throws — either on
   * `require` or inside its own `create()`. Defaults to a console warning: one
   * broken channel must not take the host down, but it must not vanish silently
   * either — a pulled bundle that expects host modules it can't resolve fails
   * exactly here, and without this the channel just never appears (no adapter,
   * no `liveChannel`, no log).
   */
  onLoadError?: (channel: string, error: unknown) => void;
  context?: PluginContext;
}

type ScanOptions = Pick<CreatePluginsOptions, 'directory' | 'readdirSync' | 'loadModule' | 'onLoadError'>;

function warnLoadFailure(channel: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[channels] "${channel}" was skipped — its plugin failed to load: ${message}`);
}

function resolveDefaultChannelsDir(): string {
  const localDir = path.join(process.cwd(), 'plugins', 'channels');
  if (fs.existsSync(localDir)) {
    return localDir;
  }
  return __dirname;
}

/** A channel module that loaded, paired with the folder it came from (for error reporting). */
interface ScannedChannel {
  channel: string;
  mod: PluginModule;
}

function scanChannelModules(options: ScanOptions = {}): ScannedChannel[] {
  const {
    directory = resolveDefaultChannelsDir(),
    readdirSync = fs.readdirSync as CreatePluginsOptions['readdirSync'],
    loadModule = (modulePath: string) => require(modulePath) as PluginModule,
    onLoadError = warnLoadFailure,
  } = options;

  if (!fs.existsSync(directory)) return [];

  return readdirSync!(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return [{ channel: entry.name, mod: loadModule(path.join(directory, entry.name)) }];
      } catch (error) {
        onLoadError(entry.name, error);
        return [];
      }
    });
}

function createPlugins(options: CreatePluginsOptions = {}): Plugin[] {
  const { context, ...scan } = options;
  const onLoadError = scan.onLoadError ?? warnLoadFailure;

  return scanChannelModules(scan).flatMap(({ channel, mod }) => {
    if (typeof mod.create !== 'function') return [];
    try {
      // `create()` is plugin code reading `context`, so it can throw for
      // reasons that have nothing to do with the host — same containment as a
      // failed `require`: report it and carry on with the other channels.
      const plugin = mod.create(context);
      return plugin ? [plugin] : [];
    } catch (error) {
      onLoadError(channel, error);
      return [];
    }
  });
}

/**
 * Every channel plugin that exports a `liveChannel` descriptor, discovered by
 * scanning `plugins/channels/*` — the same directory walk `createPlugins` does.
 * Lets the dashboard start/reprime channels without importing any by name.
 */
function listLiveChannels(options: ScanOptions = {}): LiveChannelDescriptor[] {
  return scanChannelModules(options).flatMap(({ mod }) => (mod.liveChannel ? [mod.liveChannel] : []));
}

export const CHANNELS_DIR = __dirname;
export { createPlugins, listLiveChannels, buildRegistry, PluginRegistry };
export type { Plugin };
