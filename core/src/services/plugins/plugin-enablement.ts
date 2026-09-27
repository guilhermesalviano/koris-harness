import { loadPluginConfigFile, resolvePluginDir } from '../../../../plugins/config/loader';
import type { ILogger } from '../../infrastructure/logger';
import type { IPluginSettingsRepository, PluginFamily } from '../../repositories/plugin-settings';

export interface PluginIdentity {
  family: PluginFamily;
  name: string;
}

const TOOLS_DEFAULT_DISABLED = new Set(['create-tool']);

/**
 * Code-level defaults, used only when a plugin has no DB row yet. Tools
 * default on (matching the pre-DB behavior of every tool plugin except
 * `create-tool`); channels default off, matching the pre-DB `enabled: false`
 * in every channel plugin's `config.example.yml`.
 */
export function defaultPluginEnabled(family: PluginFamily, name: string): boolean {
  if (family === 'channels' || family === 'mcps') return false;
  return !TOOLS_DEFAULT_DISABLED.has(name);
}

export function resolvePluginEnabled(
  repo: IPluginSettingsRepository,
  family: PluginFamily,
  name: string,
): boolean {
  const stored = repo.getEnabled(family, name);
  return stored ?? defaultPluginEnabled(family, name);
}

/**
 * One-time upgrade path: before this DB table existed, a plugin's on/off
 * state lived in its own gitignored `config.yml`. For every plugin that has
 * no DB row yet, read that file directly (bypassing any per-plugin schema,
 * which may no longer even declare `enabled`) and seed the DB from it, so an
 * existing install's behavior doesn't silently change on upgrade. A plugin
 * with no legacy file (or no explicit `enabled` key) is left alone — it picks
 * up the code default via `resolvePluginEnabled`.
 */
export function migrateLegacyPluginEnabledFlags(
  repo: IPluginSettingsRepository,
  identities: PluginIdentity[],
  logger: ILogger,
): void {
  for (const { family, name } of identities) {
    if (repo.getEnabled(family, name) !== null) continue;

    const pluginDir = resolvePluginDir(name, { family });
    const yamlConfig = loadPluginConfigFile({ pluginDir });
    const legacyEnabled = yamlConfig.enabled;

    if (typeof legacyEnabled === 'boolean') {
      repo.setEnabled(family, name, legacyEnabled);
      logger.info(
        `[plugin-enablement] migrated legacy enabled=${legacyEnabled} for ${family}/${name} from config.yml`,
      );
    }
  }
}
