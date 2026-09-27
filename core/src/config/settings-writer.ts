import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname as pathDirname, join, normalize } from 'path';
import { resolveConfigPaths, resolveDataDir } from './helpers';

export { applyAiProviderPatch, applyAiRolePatch, applyAiEmbedPatch, upsertAiProvider } from './ai-config';
export type { AiProviderPatch, AiRolePatch, AiEmbedPatch } from './ai-config';

const SETTINGS_FILENAME = 'koris.json';
const EXAMPLE_SETTINGS_FILENAME = 'koris.example.json';

export interface SettingsWriterOptions {
  cwd?: string;
  dirname?: string;
  exists?: (path: string) => boolean;
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
}

/**
 * Locates the app package root (the directory containing `src/`), so this
 * works both when run from the repo root and from a build under `dist/`.
 * Mirrors the anchor logic in src/onboard.ts's resolveOnboardingAppRoot.
 */
function resolveAppRoot(options?: SettingsWriterOptions): string {
  const cwd = options?.cwd ?? resolveDataDir();
  const dirname = options?.dirname ?? __dirname;
  const exists = options?.exists ?? existsSync;

  const appRoot = [
    join(cwd, 'apps', 'client'),
    join(dirname, '..'),
    join(dirname, '..', '..'),
    cwd,
  ].map((candidate) => normalize(candidate)).find((candidate) =>
    exists(join(candidate, 'src', 'onboard.ts')) || exists(join(candidate, 'dist', 'src', 'onboard.js')),
  );

  return appRoot ?? cwd;
}

function resolveExampleSettingsPath(options?: SettingsWriterOptions): string {
  const cwd = options?.cwd ?? resolveDataDir();
  const dirname = options?.dirname ?? __dirname;
  const exists = options?.exists ?? existsSync;
  const configPath = resolveConfigPaths(cwd, dirname).find((candidate) => exists(candidate));
  if (configPath) {
    return normalize(join(pathDirname(configPath), EXAMPLE_SETTINGS_FILENAME));
  }

  return normalize(join(resolveAppRoot(options), EXAMPLE_SETTINGS_FILENAME));
}

/**
 * Resolves where koris.json should be written: next to an existing
 * koris.json (or koris.example.json) if one is found, else the app root.
 */
export function resolveSettingsWritePath(options?: SettingsWriterOptions): string {
  const cwd = options?.cwd ?? resolveDataDir();
  const dirname = options?.dirname ?? __dirname;
  const exists = options?.exists ?? existsSync;
  const configPath = resolveConfigPaths(cwd, dirname).find((candidate) => exists(candidate));
  if (configPath) {
    return normalize(join(pathDirname(configPath), SETTINGS_FILENAME));
  }

  return normalize(join(resolveAppRoot({ cwd, dirname, exists }), SETTINGS_FILENAME));
}

/**
 * Loads koris.example.json as the base template for a first-time write.
 */
export function loadExampleSettingsTemplate(options?: SettingsWriterOptions): Record<string, unknown> {
  const sourcePath = resolveExampleSettingsPath(options);
  const readFile = options?.readFile ?? ((path: string) => readFileSync(path, 'utf-8'));
  return JSON.parse(readFile(sourcePath)) as Record<string, unknown>;
}

/**
 * Loads the current koris.json if one exists, else falls back to the
 * example template — the base a partial wizard payload gets merged onto.
 */
export function loadCurrentOrExampleSettings(options?: SettingsWriterOptions): Record<string, unknown> {
  const cwd = options?.cwd ?? resolveDataDir();
  const dirname = options?.dirname ?? __dirname;
  const exists = options?.exists ?? existsSync;
  const readFile = options?.readFile ?? ((path: string) => readFileSync(path, 'utf-8'));

  const configPath = resolveConfigPaths(cwd, dirname).find((candidate) => exists(candidate));
  if (configPath) {
    return JSON.parse(readFile(configPath)) as Record<string, unknown>;
  }

  return loadExampleSettingsTemplate(options);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recursively merges a partial settings patch onto a base settings object.
 * Plain objects are merged key-by-key; arrays and primitives in the patch
 * replace the base value wholesale (so e.g. `allowed_domains: [...]` or
 * `personal_information: {...}` submitted by the wizard fully replaces the
 * previous list/map rather than appending to it).
 */
export function mergeSettingsPayload(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = result[key];
    if (isPlainObject(patchValue) && isPlainObject(baseValue)) {
      result[key] = mergeSettingsPayload(baseValue, patchValue);
    } else {
      result[key] = patchValue;
    }
  }

  return result;
}

/**
 * Writes an already-built settings payload to disk, creating parent
 * directories as needed.
 */
export function writeSettingsFile(payload: Record<string, unknown>, options?: SettingsWriterOptions): string {
  const destination = resolveSettingsWritePath(options);
  const content = `${JSON.stringify(payload, null, 2)}\n`;

  mkdirSync(pathDirname(destination), { recursive: true });
  if (options?.writeFile) {
    options.writeFile(destination, content);
  } else {
    writeFileSync(destination, content, 'utf-8');
  }

  return destination;
}
