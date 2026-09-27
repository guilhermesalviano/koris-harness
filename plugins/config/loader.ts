import { existsSync, readFileSync } from 'fs';
import { join, normalize } from 'path';
import { parse } from 'yaml';

export interface PluginConfigFileIO {
  exists(path: string): boolean;
  read(path: string): string;
}

const defaultFileIO: PluginConfigFileIO = {
  exists: existsSync,
  read: (path: string) => readFileSync(path, 'utf-8'),
};

export interface LoadPluginConfigFileOptions {
  pluginDir: string;
  filename?: string;
  fileIO?: PluginConfigFileIO;
  onParseError?: (message: string) => void;
}

/**
 * Reads and parses a plugin's own `config.yml` (or `{filename}`), returning
 * `{}` when the file is missing or fails to parse — each plugin layers its
 * own defaults on top via `getPluginConfigValue`.
 */
export function loadPluginConfigFile(options: LoadPluginConfigFileOptions): Record<string, unknown> {
  const { pluginDir, filename = 'config.yml' } = options;
  const fileIO = options.fileIO ?? defaultFileIO;
  const path = normalize(join(pluginDir, filename));

  if (!fileIO.exists(path)) {
    return {};
  }

  try {
    const parsed: unknown = parse(fileIO.read(path));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    options.onParseError?.(`Warning: Failed to parse ${filename}, ignoring file.`);
    return {};
  }
}

export type PluginFamily = 'channels' | 'tools' | 'mcps';

export interface ResolvePluginDirOptions {
  cwd?: string;
  /** Falls back here (e.g. the calling module's own `__dirname`) when no cwd-relative candidate has the file — correct when running .ts sources directly in dev. */
  fallbackDir?: string;
  exists?: (path: string) => boolean;
  filename?: string;
  /** Which `plugins/<family>/` tree this plugin lives under. Defaults to `'channels'` for source compatibility with pre-existing callers. */
  family?: PluginFamily;
  /** Writable data root. Defaults to `KORIS_DATA_DIR`; when set, `config.yml` lives under `<dataDir>/plugins/<family>/<name>` instead of the (possibly read-only) bundle. */
  dataDir?: string;
}

/**
 * Locates a plugin's own directory so its `config.yml` can be found — and
 * written — at runtime even from a compiled `dist/` build (`tsc` only compiles
 * `.ts`, so `config.yml` never lands next to the `.js`, and `__dirname` points
 * at a `dist/` dir that may be read-only when packaged).
 *
 * Resolution order:
 *   1. `<dataDir>/plugins/<family>/<name>` when `KORIS_DATA_DIR` is set — the
 *      packaged desktop app splits a read-only bundle from a writable data dir,
 *      so plugin config must live there (and stays writable for the setup UI).
 *   2. `<cwd>/plugins/<family>/<name>` (and the `apps/client/` variant) — the
 *      normal repo-root case, mirroring how `resolveConfigPaths` finds `koris.json`.
 *   3. `fallbackDir` (the caller's own `__dirname`) — running `.ts` sources in dev.
 * A candidate that already contains `config.yml` wins over a later one.
 *
 * When nothing exists yet, a first-time write must NOT land in `fallbackDir`
 * from a compiled build: there `__dirname` is `dist/plugins/<family>/<name>`,
 * which `pnpm clean` (`rm -rf dist`) wipes on every `pnpm build` — silently
 * discarding whatever the setup UI saved (whitelist, bot number, …). So when
 * we can see we're running inside the repo (`<cwd>/plugins/<family>` exists),
 * that writable, build-stable dir wins over `fallbackDir`.
 */
export function resolvePluginDir(pluginName: string, options: ResolvePluginDirOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const exists = options.exists ?? existsSync;
  const filename = options.filename ?? 'config.yml';
  const family = options.family ?? 'channels';
  const dataDir = options.dataDir ?? process.env.KORIS_DATA_DIR;

  const dataDirCandidate = dataDir
    ? normalize(join(dataDir, 'plugins', family, pluginName))
    : undefined;

  const candidates = [
    ...(dataDirCandidate ? [dataDirCandidate] : []),
    join(cwd, 'plugins', family, pluginName),
    join(cwd, 'apps', 'client', 'plugins', family, pluginName),
  ].map((candidate) => normalize(candidate));

  const found = candidates.find((candidate) => exists(join(candidate, filename)));
  if (found) {
    return found;
  }

  // Nothing written yet: prefer the writable data dir when relocated.
  if (dataDirCandidate) {
    return dataDirCandidate;
  }
  // Then the repo-root plugins tree when we're clearly running inside the repo,
  // so a first-time write survives `pnpm build`'s `rm -rf dist` (unlike
  // `fallbackDir`, which from a compiled build points at `dist/`). In dev with
  // `.ts` sources, `__dirname` already IS this path, so behaviour is unchanged.
  const repoFamilyDir = normalize(join(cwd, 'plugins', family));
  if (exists(repoFamilyDir)) {
    return normalize(join(repoFamilyDir, pluginName));
  }
  // Last resort: the caller's own dir (detached execution outside any repo).
  return options.fallbackDir ? normalize(options.fallbackDir) : candidates[0];
}

/**
 * Resolves one config value with the same `env > file > fallback`
 * precedence as `src/config/helpers.ts`'s `getConfigValue`.
 */
export function getPluginConfigValue(
  yamlKey: string,
  fallback: string,
  yamlConfig: Record<string, unknown>,
  envKey: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (Object.prototype.hasOwnProperty.call(env, envKey)) {
    return String(env[envKey] ?? '');
  }

  const value = yamlConfig[yamlKey];
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value);
}
