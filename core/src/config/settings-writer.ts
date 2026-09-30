import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname as pathDirname, join, normalize } from 'path';
import { resolveConfigPaths, resolveDataDir } from './helpers';
import { isPlainObject } from '../../../plugins/config/merge';
import { writeConfigFileAtomic } from '../../../plugins/config/persistence';

export { mergeConfigPatch as mergeSettingsPayload } from '../../../plugins/config/merge';

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
 * Locates the app package root (the directory containing `package.json`), so
 * this works both when run from the repo root and from a build under `dist/`.
 */
function resolveAppRoot(options?: SettingsWriterOptions): string {
  const cwd = options?.cwd ?? resolveDataDir();
  const dirname = options?.dirname ?? __dirname;
  const exists = options?.exists ?? existsSync;

  const appRoot = [
    join(dirname, '..'),
    join(dirname, '..', '..'),
    join(dirname, '..', '..', '..'),
    join(dirname, '..', '..', '..', '..'),
    cwd,
  ].map((candidate) => normalize(candidate)).find((candidate) =>
    exists(join(candidate, 'package.json')),
  );

  return appRoot ?? cwd;
}

function resolveExampleSettingsPath(options?: SettingsWriterOptions): string {
  const cwd = options?.cwd ?? resolveDataDir();
  const dirname = options?.dirname ?? __dirname;
  const exists = options?.exists ?? existsSync;
  const configPath = resolveConfigPaths(cwd, dirname).find((candidate) => exists(candidate));
  const candidates = [
    ...(configPath ? [join(pathDirname(configPath), EXAMPLE_SETTINGS_FILENAME)] : []),
    join(cwd, EXAMPLE_SETTINGS_FILENAME),
    join(resolveAppRoot(options), EXAMPLE_SETTINGS_FILENAME),
  ].map((candidate) => normalize(candidate));
  return candidates.find(exists) ?? candidates[candidates.length - 1];
}

/**
 * Resolves where koris.json should be written: next to an existing
 * koris.json (or koris.example.json) if one is found, else the app root.
 */
export function resolveSettingsWritePath(options?: SettingsWriterOptions): string {
  const cwd = options?.cwd ?? resolveDataDir();
  const dirname = options?.dirname ?? __dirname;
  const exists = options?.exists ?? existsSync;
  // A relocated data root is always the write destination, even when reads
  // fall back to a config shipped in the application bundle.
  if (!options?.cwd && process.env.KORIS_DATA_DIR) {
    return normalize(join(cwd, SETTINGS_FILENAME));
  }
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
  return parseSettings(readFile(sourcePath));
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
    return parseSettings(readFile(configPath));
  }

  return loadExampleSettingsTemplate(options);
}

function parseSettings(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (!isPlainObject(parsed)) throw new Error('Settings must contain a JSON object.');
  return parsed;
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
    writeConfigFileAtomic(destination, content);
  }

  return destination;
}
