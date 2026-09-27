import { describe, expect, it } from 'vitest';
import {
  buildChannelsPatch,
  buildGeneralPatch,
  buildSettingsPatch,
  buildSkillsPatch,
  formatConnectionTestResult,
  isMasked,
  mapRuntimeToForm,
  DEFAULT_FORM,
} from './use-settings-form';

describe('use-settings-form: allow_unlisted_senders', () => {
  it('maps ALLOW_UNLISTED_SENDERS from the runtime snapshot into the form', () => {
    const form = mapRuntimeToForm({
      CHANNELS: {
        TELEGRAM: { WHITELIST: '1', ALLOW_UNLISTED_SENDERS: true },
        WHATSAPP: { WHITELIST: '2', ALLOW_UNLISTED_SENDERS: false },
      },
    });
    expect(form.telegram.allow_unlisted_senders).toBe(true);
    expect(form.whatsapp.allow_unlisted_senders).toBe(false);
  });

  it('defaults allow_unlisted_senders to false when the snapshot omits it', () => {
    const form = mapRuntimeToForm({ CHANNELS: { TELEGRAM: { WHITELIST: '1' } } });
    expect(form.telegram.allow_unlisted_senders).toBe(false);
    expect(form.whatsapp.allow_unlisted_senders).toBe(false);
  });

  it('emits allow_unlisted_senders for both channels in the channels patch', () => {
    const form = {
      ...DEFAULT_FORM,
      telegram: { ...DEFAULT_FORM.telegram, allow_unlisted_senders: true },
      whatsapp: { ...DEFAULT_FORM.whatsapp, allow_unlisted_senders: false },
    };
    const patch = buildChannelsPatch(form) as {
      channels: { telegram: Record<string, unknown>; whatsapp: Record<string, unknown> };
    };
    expect(patch.channels.telegram.allow_unlisted_senders).toBe(true);
    expect(patch.channels.whatsapp.allow_unlisted_senders).toBe(false);
  });
});

describe('use-settings-form: num_ctx', () => {
  it('maps NUM_CTX from the runtime snapshot into each profile form', () => {
    const form = mapRuntimeToForm({
      AI: { MANAGER: { PROVIDER: 'openrouter', MODEL: 'qwen', NUM_CTX: 80000 }, WORKERS: { PROVIDER: 'ollama', MODEL: 'gemma' } },
    });
    expect(form.manager.num_ctx).toBe('80000');
    expect(form.workers.num_ctx).toBe('');
    expect(form.sameForBoth).toBe(false);
  });

  it('emits a floored positive num_ctx and omits a blank/zero one', () => {
    const withValue = buildSettingsPatch({
      ...DEFAULT_FORM,
      sameForBoth: false,
      manager: { ...DEFAULT_FORM.manager, provider: 'openrouter', model: 'qwen', num_ctx: '32768' },
      workers: { ...DEFAULT_FORM.workers, provider: 'ollama', model: 'gemma', num_ctx: '0' },
    }) as { ai: { manager: Record<string, unknown>; workers: Record<string, unknown> } };
    expect(withValue.ai.manager.num_ctx).toBe(32768);
    expect(withValue.ai.workers.num_ctx).toBeUndefined();
  });
});

describe('use-settings-form: skills', () => {
  it('maps SKILLS from the runtime settings', () => {
    const form = mapRuntimeToForm({ SKILLS: { MODE: 'manual', LIMIT: 4 } });

    expect(form.skills_mode).toBe('manual');
    expect(form.skills_limit).toBe('4');
  });

  it('falls back to auto when SKILLS is absent or unrecognised', () => {
    expect(mapRuntimeToForm({}).skills_mode).toBe('auto');
    expect(mapRuntimeToForm({ SKILLS: { MODE: 'nope' as never } }).skills_mode).toBe('auto');
  });

  it('builds a skills patch with mode and limit', () => {
    expect(buildSkillsPatch({ ...DEFAULT_FORM, skills_mode: 'manual', skills_limit: '5' }))
      .toEqual({ skills: { mode: 'manual', limit: 5 } });
  });

  it('omits an empty or invalid limit so the server keeps the stored one', () => {
    expect(buildSkillsPatch({ ...DEFAULT_FORM, skills_limit: '' })).toEqual({ skills: { mode: 'auto' } });
    expect(buildSkillsPatch({ ...DEFAULT_FORM, skills_limit: '0' })).toEqual({ skills: { mode: 'auto' } });
    expect(buildSkillsPatch({ ...DEFAULT_FORM, skills_limit: 'abc' })).toEqual({ skills: { mode: 'auto' } });
  });
});


describe('general settings removals', () => {
  it('includes empty lists and maps so clearing the final entry is persisted', () => {
    expect(buildGeneralPatch({ ...DEFAULT_FORM, allowed_domains: [], personal_information: {} }))
      .toEqual({ allowed_domains: [], personal_information: {} });
  });
});

describe('isMasked', () => {
  it('detects masking markers', () => {
    expect(isMasked('••••')).toBe(true);
    expect(isMasked('prefix-••••-suffix')).toBe(true);
    expect(isMasked('normal-key')).toBe(false);
    expect(isMasked('')).toBe(false);
    expect(isMasked(undefined)).toBe(false);
  });
});

describe('formatConnectionTestResult', () => {
  it('formats successful connection results', () => {
    expect(formatConnectionTestResult({ ok: true, skipped: true })).toBe('mock provider — no check needed');
    expect(formatConnectionTestResult({ ok: true, detail: '0.4.1' })).toBe('reachable (v0.4.1)');
    expect(formatConnectionTestResult({ ok: true })).toBe('reachable');
  });

  it('formats failed connection results', () => {
    expect(formatConnectionTestResult({ ok: false, authFailed: true, status: 401 })).toBe('auth failed (HTTP 401)');
    expect(formatConnectionTestResult({ ok: false, error: 'Connection refused', status: 500 })).toBe('Connection refused');
    expect(formatConnectionTestResult({ ok: false, status: 502 })).toBe('HTTP 502');
  });
});

describe('mapRuntimeToForm & buildSettingsPatch branches', () => {
  it('detects sameForBoth when manager and workers profiles match', () => {
    const form = mapRuntimeToForm({
      AI: {
        MANAGER: { PROVIDER: 'ollama', BASE_URL: 'http://localhost:11434', MODEL: 'llama3', NUM_CTX: 4096 },
        WORKERS: { PROVIDER: 'ollama', BASE_URL: 'http://localhost:11434', MODEL: 'llama3', NUM_CTX: 4096 },
      },
    });
    expect(form.sameForBoth).toBe(true);
  });

  it('handles masked secrets by setting empty string defaults', () => {
    const form = mapRuntimeToForm({
      AI: {
        MANAGER: { PROVIDER: 'openai', API_TOKEN: '••••masked••••' },
      },
      CHANNELS: {
        TELEGRAM: { BOT_TOKEN: '••••bot••••' },
      },
    });
    expect(form.manager.api_token).toBe('');
    expect(form.telegram.bot_token).toBe('');
  });

  it('builds full settings patch with tokens, domains, and personal information', () => {
    const form = {
      ...DEFAULT_FORM,
      sameForBoth: true,
      manager: { provider: 'openai', base_url: 'https://api.openai.com', api_token: 'secret-token', model: 'gpt-4o', num_ctx: '16000' },
      telegram: { bot_token: '12345:ABC', whitelist: 'admin', allow_unlisted_senders: true },
      whatsapp: { whitelist: 'all', allow_unlisted_senders: false },
      allowed_domains: ['api.example.com'],
      personal_information: { name: 'Koris' },
    };

    const patch = buildSettingsPatch(form) as any;
    expect(patch.ai.manager.api_token).toBe('secret-token');
    expect(patch.ai.workers.api_token).toBe('secret-token');
    expect(patch.channels.telegram.bot_token).toBe('12345:ABC');
    expect(patch.allowed_domains).toEqual(['api.example.com']);
    expect(patch.personal_information).toEqual({ name: 'Koris' });
  });
});
