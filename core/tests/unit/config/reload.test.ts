/// <reference types="node" />

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { config, reloadConfig } from '../../../src/config';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'koris-config-reload-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  // Restore the singleton to its real-repo state (no koris.json checked in).
  reloadConfig();
});

describe('config/index reloadConfig', () => {
  it('applies newly written koris.json values onto the existing config reference', () => {
    const dir = createTempDir();
    writeFileSync(join(dir, 'koris.json'), JSON.stringify({ web_port: 4321, timezone: 'UTC' }));

    reloadConfig({ cwd: dir, dirname: dir });

    expect(config.WEB_PORT).toBe(4321);
    expect(config.TIMEZONE).toBe('UTC');
  });

  it('keeps the same object identity across a reload', () => {
    const before = config;
    const dir = createTempDir();
    writeFileSync(join(dir, 'koris.json'), JSON.stringify({ web_port: 5555 }));

    reloadConfig({ cwd: dir, dirname: dir });

    expect(config).toBe(before);
    expect(config.WEB_PORT).toBe(5555);
  });

  it('picks up nested AI values after a reload', () => {
    const dir = createTempDir();
    writeFileSync(join(dir, 'koris.json'), JSON.stringify({
      ai: {
        providers: [
          { provider: 'ollama', base_url: 'http://example.invalid:1234', api_token: '', model: 'reload-model' },
        ],
        roles: { manager: { provider: 'ollama' } },
        embed: { enabled: true, provider: 'ollama', model: 'reload-embed' },
      },
    }));

    reloadConfig({ cwd: dir, dirname: dir });

    expect(config.AI.MANAGER.BASE_URL).toBe('http://example.invalid:1234');
    expect(config.AI.MANAGER.MODEL).toBe('reload-model');
    expect(config.AI.EMBED.ENABLED).toBe(true);
    expect(config.AI.EMBED.MODEL).toBe('reload-embed');
    expect(config.AI.EMBED.BASE_URL).toBe('http://example.invalid:1234');
    // Embedding settings no longer live on config.AI.WORKERS.
    expect((config.AI.WORKERS as Record<string, unknown>).EMBEDDING_ENABLED).toBeUndefined();
    expect((config.AI.WORKERS as Record<string, unknown>).EMBED_MODEL).toBeUndefined();
  });
});

describe('config/index skills', () => {
  function reloadWith(settings: Record<string, unknown>) {
    const dir = createTempDir();
    writeFileSync(join(dir, 'koris.json'), JSON.stringify(settings));
    reloadConfig({ cwd: dir, dirname: dir });
  }

  it('defaults to auto mode with a limit of 10', () => {
    reloadWith({});

    expect(config.SKILLS.MODE).toBe('auto');
    expect(config.SKILLS.LIMIT).toBe(10);
  });

  it('reads skills.mode and skills.limit', () => {
    reloadWith({ skills: { mode: 'manual', limit: 3 } });

    expect(config.SKILLS.MODE).toBe('manual');
    expect(config.SKILLS.LIMIT).toBe(3);
  });

  it('falls back to auto for an unrecognised mode', () => {
    reloadWith({ skills: { mode: 'nope' } });

    expect(config.SKILLS.MODE).toBe('auto');
  });

  it('falls back to 10 for a non-positive or non-integer limit', () => {
    reloadWith({ skills: { limit: 0 } });
    expect(config.SKILLS.LIMIT).toBe(10);

    reloadWith({ skills: { limit: 'many' } });
    expect(config.SKILLS.LIMIT).toBe(10);
  });

  it('still honours the legacy top-level learned_skills_limit', () => {
    reloadWith({ learned_skills_limit: 4 });

    expect(config.SKILLS.LIMIT).toBe(4);
  });

  it('prefers skills.limit over the legacy key', () => {
    reloadWith({ learned_skills_limit: 4, skills: { limit: 7 } });

    expect(config.SKILLS.LIMIT).toBe(7);
  });
});

describe('config/index audio', () => {
  function reloadWith(settings: Record<string, unknown>) {
    const dir = createTempDir();
    writeFileSync(join(dir, 'koris.json'), JSON.stringify(settings));
    reloadConfig({ cwd: dir, dirname: dir });
  }

  it('defaults audio STT configuration when empty', () => {
    reloadWith({});

    expect(config.AUDIO.STT.ENABLED).toBe(false);
    expect(config.AUDIO.STT.ENDPOINT).toBe('http://127.0.0.1:6006/v1/audio/transcriptions');
    expect(config.AUDIO.STT.LANGUAGE).toBe('auto');
    expect(config.AUDIO.STT.TIMEOUT_MS).toBe(30000);
  });

  it('reads audio.stt values from config file', () => {
    reloadWith({
      audio: {
        stt: {
          enabled: true,
          endpoint: 'http://custom-host:8000/transcribe',
          language: 'pt',
          timeout_ms: 15000,
        },
      },
    });

    expect(config.AUDIO.STT.ENABLED).toBe(true);
    expect(config.AUDIO.STT.ENDPOINT).toBe('http://custom-host:8000/transcribe');
    expect(config.AUDIO.STT.LANGUAGE).toBe('pt');
    expect(config.AUDIO.STT.TIMEOUT_MS).toBe(15000);
  });

  it('honours AUDIO_STT_ENABLED and AUDIO_STT_ENDPOINT env overrides', () => {
    const prevEnabled = process.env.AUDIO_STT_ENABLED;
    const prevEndpoint = process.env.AUDIO_STT_ENDPOINT;

    try {
      process.env.AUDIO_STT_ENABLED = 'true';
      process.env.AUDIO_STT_ENDPOINT = 'http://env-host:9999/v1';

      reloadWith({});

      expect(config.AUDIO.STT.ENABLED).toBe(true);
      expect(config.AUDIO.STT.ENDPOINT).toBe('http://env-host:9999/v1');
    } finally {
      if (prevEnabled !== undefined) {
        process.env.AUDIO_STT_ENABLED = prevEnabled;
      } else {
        delete process.env.AUDIO_STT_ENABLED;
      }
      if (prevEndpoint !== undefined) {
        process.env.AUDIO_STT_ENDPOINT = prevEndpoint;
      } else {
        delete process.env.AUDIO_STT_ENDPOINT;
      }
    }
  });

  it('defaults audio TTS configuration when empty', () => {
    reloadWith({});

    expect(config.AUDIO.TTS.ENABLED).toBe(false);
    expect(config.AUDIO.TTS.ENDPOINT).toBe('http://127.0.0.1:6006/v1/audio/speech');
    expect(config.AUDIO.TTS.VOICE).toBe('en_US-lessac-medium');
    expect(config.AUDIO.TTS.SPEED).toBe(1.0);
    expect(config.AUDIO.TTS.MAX_INPUT_CHARS).toBe(5000);
    expect(config.AUDIO.TTS.TIMEOUT_MS).toBe(30000);
  });

  it('reads audio.tts values from config file', () => {
    reloadWith({
      audio: {
        tts: {
          enabled: true,
          endpoint: 'http://custom-host:8000/speak',
          voice: 'en_GB-alba-medium',
          speed: 1.5,
          max_input_chars: 1200,
          timeout_ms: 15000,
        },
      },
    });

    expect(config.AUDIO.TTS.ENABLED).toBe(true);
    expect(config.AUDIO.TTS.ENDPOINT).toBe('http://custom-host:8000/speak');
    expect(config.AUDIO.TTS.VOICE).toBe('en_GB-alba-medium');
    expect(config.AUDIO.TTS.SPEED).toBe(1.5);
    expect(config.AUDIO.TTS.MAX_INPUT_CHARS).toBe(1200);
    expect(config.AUDIO.TTS.TIMEOUT_MS).toBe(15000);
  });

  it('honours AUDIO_TTS_ENABLED and AUDIO_TTS_ENDPOINT env overrides', () => {
    const prevEnabled = process.env.AUDIO_TTS_ENABLED;
    const prevEndpoint = process.env.AUDIO_TTS_ENDPOINT;

    try {
      process.env.AUDIO_TTS_ENABLED = 'true';
      process.env.AUDIO_TTS_ENDPOINT = 'http://env-host:9999/speak';

      reloadWith({});

      expect(config.AUDIO.TTS.ENABLED).toBe(true);
      expect(config.AUDIO.TTS.ENDPOINT).toBe('http://env-host:9999/speak');
    } finally {
      if (prevEnabled !== undefined) {
        process.env.AUDIO_TTS_ENABLED = prevEnabled;
      } else {
        delete process.env.AUDIO_TTS_ENABLED;
      }
      if (prevEndpoint !== undefined) {
        process.env.AUDIO_TTS_ENDPOINT = prevEndpoint;
      } else {
        delete process.env.AUDIO_TTS_ENDPOINT;
      }
    }
  });
});

