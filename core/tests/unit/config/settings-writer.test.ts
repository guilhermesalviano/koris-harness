/// <reference types="node" />

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  resolveSettingsWritePath,
  loadExampleSettingsTemplate,
  loadCurrentOrExampleSettings,
  writeSettingsFile,
  mergeSettingsPayload,
  applyAiRolePatch,
  applyAiEmbedPatch,
} from '../../../src/config/settings-writer';

const REAL_EXAMPLE_SETTINGS_PATH = join(__dirname, '..', '..', '..', '..', 'koris.example.json');

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'koris-settings-writer-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('config/settings-writer', () => {
  it('writes to <cwd>/koris.json when no koris.json exists anywhere yet', () => {
    const dir = createTempDir();

    const written = writeSettingsFile({ web_port: 4000 }, { cwd: dir, dirname: dir });

    expect(written).toBe(join(dir, 'koris.json'));
    expect(existsSync(written)).toBe(true);
    expect(JSON.parse(readFileSync(written, 'utf-8'))).toEqual({ web_port: 4000 });
  });

  it('writes back to an already-existing koris.json rather than a different candidate', () => {
    const dir = createTempDir();
    const existingPath = join(dir, 'koris.json');
    writeFileSync(existingPath, JSON.stringify({ web_port: 1234 }));

    const resolved = resolveSettingsWritePath({ cwd: dir, dirname: dir });
    expect(resolved).toBe(existingPath);

    const written = writeSettingsFile({ web_port: 9999 }, { cwd: dir, dirname: dir });
    expect(written).toBe(existingPath);
    expect(JSON.parse(readFileSync(existingPath, 'utf-8'))).toEqual({ web_port: 9999 });
  });

  it('loads the real koris.example.json shape', () => {
    const dir = createTempDir();
    copyFileSync(REAL_EXAMPLE_SETTINGS_PATH, join(dir, 'koris.example.json'));

    const template = loadExampleSettingsTemplate({ cwd: dir, dirname: dir });

    expect(template).toHaveProperty('web_port');
    expect(template).toHaveProperty('ai');
    expect(template).toHaveProperty('github');
    expect(template).toHaveProperty('personal_information');
  });

  it('deep-merges a partial patch onto a base object without touching untouched branches', () => {
    const base = {
      web_port: 3000,
      ai: { manager: { provider: 'ollama', model: 'gemma4:e4b' }, workers: { provider: 'ollama' } },
      channels: { telegram: { enabled: false, bot_token: '' } },
    };

    const merged = mergeSettingsPayload(base, {
      ai: { manager: { provider: 'nvidia' } },
    });

    expect(merged).toEqual({
      web_port: 3000,
      ai: { manager: { provider: 'nvidia', model: 'gemma4:e4b' }, workers: { provider: 'ollama' } },
      channels: { telegram: { enabled: false, bot_token: '' } },
    });
  });

  it('replaces arrays and primitives wholesale instead of merging them', () => {
    const merged = mergeSettingsPayload(
      { allowed_domains: ['a.com', 'b.com'], log_level: 'info' },
      { allowed_domains: ['c.com'], log_level: 'debug' },
    );

    expect(merged).toEqual({ allowed_domains: ['c.com'], log_level: 'debug' });
  });

  it('loadCurrentOrExampleSettings prefers an existing koris.json over the example template', () => {
    const dir = createTempDir();
    writeFileSync(join(dir, 'koris.json'), JSON.stringify({ web_port: 7777 }));

    const loaded = loadCurrentOrExampleSettings({ cwd: dir, dirname: dir });

    expect(loaded).toEqual({ web_port: 7777 });
  });

  it('applyAiRolePatch keeps a previously-configured provider when activating another', () => {
    const base = {
      ai: {
        providers: [
          { provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' },
        ],
        roles: {
          manager: { provider: 'ollama' },
          workers: { provider: 'ollama' },
        },
      },
    };

    const once = applyAiRolePatch(base, 'manager', {
      provider: 'openai',
      base_url: 'https://api.openai.com/v1',
      api_token: 'sk-1',
      model: 'gpt-4o-mini',
    });
    const twice = applyAiRolePatch(once, 'manager', {
      provider: 'ollama',
      model: 'gemma',
    });

    const ai = twice.ai as { providers: { provider: string }[]; roles: Record<string, unknown> };
    expect(ai.providers.map((p) => p.provider)).toEqual(['ollama', 'openai']);
    expect(ai.roles.manager).toEqual({ provider: 'ollama' });
  });

  it('applyAiEmbedPatch points ai.embed at a provider without touching the roles', () => {
    const base = {
      ai: {
        providers: [
          { provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' },
          { provider: 'openai', base_url: '', api_token: 'sk-1', model: 'gpt-4o-mini' },
        ],
        roles: { manager: { provider: 'ollama' }, workers: { provider: 'openai' } },
      },
    };

    const out = applyAiEmbedPatch(base, { enabled: true, provider: 'ollama', model: 'nomic-embed-text' });
    const ai = out.ai as { embed: Record<string, unknown>; roles: Record<string, unknown> };

    expect(ai.embed).toEqual({ enabled: true, provider: 'ollama', model: 'nomic-embed-text' });
    expect(ai.roles).toEqual({ manager: { provider: 'ollama' }, workers: { provider: 'openai' } });
  });

  it('loadCurrentOrExampleSettings falls back to the example template when no koris.json exists', () => {
    const dir = createTempDir();
    copyFileSync(REAL_EXAMPLE_SETTINGS_PATH, join(dir, 'koris.example.json'));

    const loaded = loadCurrentOrExampleSettings({ cwd: dir, dirname: dir });

    expect(loaded).toHaveProperty('web_port');
    expect(loaded).toHaveProperty('ai');
  });
});
