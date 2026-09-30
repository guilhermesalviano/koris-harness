import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join, normalize } from 'path';
import { parse, stringify } from 'yaml';
import { isPlainObject, mergeConfigPatch } from './merge';
import { writeConfigFileAtomic } from './persistence';

export { mergeConfigPatch as mergePluginConfigPatch } from './merge';

export interface PluginConfigWriteOptions {
  pluginDir: string;
  filename?: string;
  exists?: (path: string) => boolean;
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
}

/**
 * Merges `patch` onto the plugin's current `config.yml` (or `{}` if none
 * exists yet) and writes the result back as YAML, creating the plugin
 * directory if needed. Returns the path written.
 */
export function writePluginConfigPatch(
  patch: Record<string, unknown>,
  options: PluginConfigWriteOptions,
): string {
  const { pluginDir, filename = 'config.yml' } = options;
  const exists = options.exists ?? existsSync;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf-8'));
  const path = normalize(join(pluginDir, filename));

  let current: Record<string, unknown> = {};
  if (exists(path)) {
    const parsed: unknown = parse(readFile(path));
    if (parsed !== null && !isPlainObject(parsed)) {
      throw new Error(`Plugin config ${path} must contain a YAML object.`);
    }
    current = parsed ?? {};
  }

  const merged = mergeConfigPatch(current, patch);
  const content = stringify(merged);

  mkdirSync(dirname(path), { recursive: true });
  if (options.writeFile) {
    options.writeFile(path, content);
  } else {
    writeConfigFileAtomic(path, content);
  }

  return path;
}
