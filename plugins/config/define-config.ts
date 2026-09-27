import { getPluginConfigValue, loadPluginConfigFile, resolvePluginDir, type PluginConfigFileIO, type PluginFamily } from './loader';
import { writePluginConfigPatch } from './writer';

export interface PluginConfigFieldSpec<TValue> {
  yamlKey: string;
  envKey: string;
  fallback: string;
  parse?: (raw: string) => TValue;
}

export type PluginConfigSchema<TConfig> = {
  [K in keyof TConfig]: PluginConfigFieldSpec<TConfig[K]>;
};

export interface LoadPluginConfigOptions {
  pluginDir?: string;
  fileIO?: PluginConfigFileIO;
  env?: NodeJS.ProcessEnv;
  onParseError?: (message: string) => void;
}

export interface WritePluginConfigOptions {
  pluginDir?: string;
  exists?: (path: string) => boolean;
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
}

export interface PluginConfigModule<TConfig> {
  load(options?: LoadPluginConfigOptions): TConfig;
  writePatch(patch: Record<string, unknown>, options?: WritePluginConfigOptions): string;
}

export interface PluginConfigDefinition<TConfig> {
  /** Which `plugins/<family>/` tree this plugin lives under. */
  family: PluginFamily;
  pluginName: string;
  /** __dirname of the calling plugin's config.ts — used as a resolution fallback. */
  fallbackDir: string;
  schema: PluginConfigSchema<TConfig>;
}

export function definePluginConfig<TConfig>(
  definition: PluginConfigDefinition<TConfig>,
): PluginConfigModule<TConfig> {
  const { family, pluginName, fallbackDir, schema } = definition;

  return {
    load(options = {}) {
      const pluginDir = options.pluginDir ?? resolvePluginDir(pluginName, { family, fallbackDir });
      const yamlConfig = loadPluginConfigFile({
        pluginDir,
        fileIO: options.fileIO,
        onParseError: options.onParseError,
      });
      const env = options.env ?? process.env;

      const result = {} as TConfig;
      for (const key of Object.keys(schema) as Array<keyof TConfig>) {
        const spec = schema[key];
        const raw = getPluginConfigValue(spec.yamlKey, spec.fallback, yamlConfig, spec.envKey, env);
        result[key] = (spec.parse ? spec.parse(raw) : (raw as unknown)) as TConfig[typeof key];
      }
      return result;
    },

    writePatch(patch, options = {}) {
      const pluginDir = options.pluginDir ?? resolvePluginDir(pluginName, { family, fallbackDir, exists: options.exists });
      return writePluginConfigPatch(patch, { ...options, pluginDir });
    },
  };
}
