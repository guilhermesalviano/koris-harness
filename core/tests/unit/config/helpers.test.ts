/// <reference types="node" />

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { getConfigValue, isConfigFilePresent, loadConfigFile, resolveConfigPaths, toEnvKey } from '../../../src/config/helpers';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'koris-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('config/helpers', () => {
  it('reads apps/client/koris.json when running from the monorepo root', () => {
    const repoRoot = createTempDir();
    const appRoot = join(repoRoot, 'apps', 'client');
    const runtimeDir = join(appRoot, 'dist', 'src', 'config');

    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(appRoot, 'koris.json'), JSON.stringify({
      telegram: { BOT_TOKEN: 'test-token' },
    }));

    const fileConfig = loadConfigFile({ cwd: repoRoot, dirname: runtimeDir });

    expect(fileConfig).toEqual({
      telegram: { BOT_TOKEN: 'test-token' },
    });
  });

  it('prefers environment variables over file values', () => {
    const value = getConfigValue(
      'telegram.BOT_TOKEN',
      '',
      { telegram: { BOT_TOKEN: 'from-file' } },
      { TELEGRAM_BOT_TOKEN: 'from-env' },
    );

    expect(value).toBe('from-env');
  });

  it('maps dotted config paths to uppercase environment keys', () => {
    expect(toEnvKey('ai.searxng_url')).toBe('AI_SEARXNG_URL');
  });

  it('checks the monorepo apps/client settings path as a candidate', () => {
    const repoRoot = createTempDir();
    const runtimeDir = join(repoRoot, 'apps', 'client', 'src', 'config');

    const paths = resolveConfigPaths(repoRoot, runtimeDir);

    expect(paths).toContain(join(repoRoot, 'apps', 'client', 'koris.json'));
  });

  it('detects whether config file is present on disk', () => {
    const repoRoot = createTempDir();
    expect(isConfigFilePresent(repoRoot)).toBe(false);

    writeFileSync(join(repoRoot, 'koris.json'), '{}');
    expect(isConfigFilePresent(repoRoot)).toBe(true);
  });

  it('finds package settings from the compiled core layout outside the package cwd', () => {
    const packageRoot = createTempDir();
    const unrelatedCwd = createTempDir();
    writeFileSync(join(packageRoot, 'koris.json'), '{"web_port":4000}');
    expect(loadConfigFile({ cwd: unrelatedCwd, dirname: join(packageRoot, 'dist', 'core', 'src', 'config') }))
      .toEqual({ web_port: 4000 });
  });

  it.each(['null', '[]', '"text"', '42'])('ignores non-object config %s', (content) => {
    const warnings: string[] = [];
    expect(loadConfigFile({
      fileIO: { exists: () => true, read: () => content },
      onParseError: (message) => warnings.push(message),
    })).toEqual({});
    expect(warnings).toHaveLength(1);
  });

  it('does not read inherited config values', () => {
    expect(getConfigValue('constructor.name', 'fallback', {}, {})).toBe('fallback');
    expect(getConfigValue('toString', 'fallback', {}, {})).toBe('fallback');
  });
});
