import { existsSync, readFileSync } from 'fs';
import { join, normalize } from 'path';

export interface ConfigFileIO {
  exists(path: string): boolean;
  read(path: string): string;
}

const defaultFileIO: ConfigFileIO = {
  exists: existsSync,
  read: (path: string) => readFileSync(path, 'utf-8'),
};

/**
 * Writable data root. In a normal checkout this is the cwd; a packaged desktop
 * build sets KORIS_DATA_DIR to a per-user writable directory (the app bundle
 * itself is read-only), so koris.json, memory/ and logs/ land there.
 */
export function resolveDataDir(cwd: string = process.cwd()): string {
  return process.env.KORIS_DATA_DIR || cwd;
}

export function resolveConfigPaths(cwd: string = resolveDataDir(), dirname: string = __dirname): string[] {
  return Array.from(new Set([
    join(cwd, 'koris.json'),
    join(cwd, 'apps', 'client', 'koris.json'),
    join(dirname, '..', '..', 'koris.json'),
    join(dirname, '..', '..', '..', 'koris.json'),
  ].map((path) => normalize(path))));
}

export function isConfigFilePresent(cwd: string = resolveDataDir(), dirname?: string): boolean {
  const effectiveDirname = dirname ?? (cwd === resolveDataDir() ? __dirname : cwd);
  return resolveConfigPaths(cwd, effectiveDirname).some(existsSync);
}

export function loadConfigFile(options?: {
  cwd?: string;
  dirname?: string;
  fileIO?: ConfigFileIO;
  onParseError?: (message: string) => void;
}): Record<string, unknown> {
  const cwd = options?.cwd ?? resolveDataDir();
  const dirname = options?.dirname ?? __dirname;
  const fileIO = options?.fileIO ?? defaultFileIO;

  const configPath = resolveConfigPaths(cwd, dirname).find((candidate) => fileIO.exists(candidate));
  if (!configPath) {
    return {};
  }

  try {
    return JSON.parse(fileIO.read(configPath)) as Record<string, unknown>;
  } catch {
    options?.onParseError?.('Warning: Failed to parse koris.json, ignoring file.');
    return {};
  }
}

export function deepGet(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }

    return undefined;
  }, obj);
}

export function toEnvKey(path: string): string {
  return path.replace(/\./g, '_').toUpperCase();
}

export function getConfigValue(
  path: string,
  fallback: string,
  fileConfig: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const envKey = toEnvKey(path);
  if (Object.prototype.hasOwnProperty.call(env, envKey)) {
    return String(env[envKey] ?? '');
  }

  const fileValue = deepGet(fileConfig, path);
  if (fileValue === undefined || fileValue === null) {
    return fallback;
  }

  return String(fileValue);
}
