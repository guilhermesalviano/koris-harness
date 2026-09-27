import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, normalize } from 'path';
import { parse, stringify } from 'yaml';

export interface PluginConfigWriteOptions {
  pluginDir: string;
  filename?: string;
  exists?: (path: string) => boolean;
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recursively merges a partial config patch onto a base config object.
 * Mirrors `src/config/settings-writer.ts`'s `mergeSettingsPayload` — kept as
 * a small separate copy since plugins may not import from `src/`.
 */
export function mergePluginConfigPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = result[key];
    result[key] = isPlainObject(patchValue) && isPlainObject(baseValue)
      ? mergePluginConfigPatch(baseValue, patchValue)
      : patchValue;
  }

  return result;
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
    try {
      const parsed: unknown = parse(readFile(path));
      if (isPlainObject(parsed)) {
        current = parsed;
      }
    } catch {
      // Corrupt existing file — overwrite it with the patch instead of failing the write.
    }
  }

  const merged = mergePluginConfigPatch(current, patch);
  const content = stringify(merged);

  mkdirSync(dirname(path), { recursive: true });
  if (options.writeFile) {
    options.writeFile(path, content);
  } else {
    writeFileSync(path, content, 'utf-8');
  }

  return path;
}
