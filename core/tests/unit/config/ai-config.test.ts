import { describe, expect, it } from 'vitest';

import {
  applyAiEmbedPatch,
  applyAiProviderPatch,
  applyAiRolePatch,
  resolveAiRoles,
  resolveEmbed,
  upsertAiProvider,
} from '../../../src/config/ai-config';

describe('config/ai-config', () => {
  describe('resolveAiRoles', () => {
    it('joins a role pointer to its provider entry credentials and model', () => {
      const roles = resolveAiRoles({
        embed: { enabled: true, provider: 'ollama', model: 'nomic' },
        providers: [
          { provider: 'ollama', base_url: 'http://host:11434', api_token: '', num_ctx: 32768, model: 'gemma' },
          { provider: 'openai', base_url: '', api_token: 'sk-abc', model: 'gpt-4o-mini' },
        ],
        roles: {
          manager: { provider: 'openai' },
          workers: { provider: 'ollama' },
        },
      });

      expect(roles.MANAGER).toEqual({
        PROVIDER: 'openai',
        BASE_URL: '',
        API_TOKEN: 'sk-abc',
        MODEL: 'gpt-4o-mini',
        // no num_ctx on the openai entry → default preset
        NUM_CTX: 16384,
      });
      expect(roles.WORKERS).toEqual({
        PROVIDER: 'ollama',
        BASE_URL: 'http://host:11434',
        API_TOKEN: '',
        MODEL: 'gemma',
        NUM_CTX: 32768,
      });
      expect(roles.EMBED).toEqual({
        ENABLED: true,
        PROVIDER: 'ollama',
        BASE_URL: 'http://host:11434',
        API_TOKEN: '',
        MODEL: 'nomic',
      });
    });

    it('falls back to defaults for a role pointing at an unknown provider', () => {
      const roles = resolveAiRoles({
        providers: [{ provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' }],
        roles: { manager: { provider: 'lmstudio' } },
      });

      expect(roles.MANAGER.PROVIDER).toBe('lmstudio');
      expect(roles.MANAGER.BASE_URL).toBe('');
      expect(roles.MANAGER.API_TOKEN).toBe('');
      // no matching entry → the built-in default model
      expect(roles.MANAGER.MODEL).toBe('gemma4:e2b');
    });

    it('uses built-in defaults for an empty ai block', () => {
      const roles = resolveAiRoles({});
      expect(roles.MANAGER.PROVIDER).toBe('ollama');
      expect(roles.MANAGER.MODEL).toBe('gemma4:e2b');
      expect(roles.MANAGER.NUM_CTX).toBe(16384);
      expect(roles.WORKERS.MODEL).toBe('qwen:3.5:2b');
      expect(roles.WORKERS.NUM_CTX).toBe(16384);
    });

    it('resolves the manager num_ctx from its own provider entry', () => {
      const roles = resolveAiRoles({
        providers: [
          { provider: 'openrouter', base_url: '', api_token: 'sk-or', model: 'qwen', num_ctx: 80000 },
          { provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' },
        ],
        roles: { manager: { provider: 'openrouter' }, workers: { provider: 'ollama' } },
      });

      expect(roles.MANAGER.NUM_CTX).toBe(80000);
      // no num_ctx on the ollama entry → default preset
      expect(roles.WORKERS.NUM_CTX).toBe(16384);
    });

    it('coerces a stringy num_ctx on the provider entry', () => {
      const roles = resolveAiRoles({
        providers: [{ provider: 'openrouter', base_url: '', api_token: 'sk-or', model: 'qwen', num_ctx: '83222' }],
        roles: { manager: { provider: 'openrouter' } },
      });

      expect(roles.MANAGER.NUM_CTX).toBe(83222);
    });
  });

  describe('upsertAiProvider', () => {
    it('adds a new provider and preserves existing ones', () => {
      const ai: Record<string, unknown> = {
        providers: [{ provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' }],
      };

      upsertAiProvider(ai, { provider: 'openai', base_url: 'https://api.openai.com/v1', api_token: 'sk-1', model: 'gpt-4o-mini' });

      expect(ai.providers).toEqual([
        { provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' },
        { provider: 'openai', base_url: 'https://api.openai.com/v1', api_token: 'sk-1', model: 'gpt-4o-mini' },
      ]);
    });

    it('overwrites the model on an existing provider and does not overwrite creds with blanks', () => {
      const ai: Record<string, unknown> = {
        providers: [{ provider: 'ollama', base_url: 'http://host:11434', api_token: 'keep', model: 'gemma' }],
      };

      upsertAiProvider(ai, { provider: 'ollama', base_url: '', api_token: '', model: 'qwen' });

      expect(ai.providers).toEqual([
        { provider: 'ollama', base_url: 'http://host:11434', api_token: 'keep', model: 'qwen' },
      ]);
    });

    it('creates an entry with an empty model string when the patch omits it', () => {
      const ai: Record<string, unknown> = {};

      upsertAiProvider(ai, { provider: 'nvidia', api_token: 'nv-key' });

      expect(ai.providers).toEqual([
        { provider: 'nvidia', base_url: '', api_token: 'nv-key', model: '' },
      ]);
    });
  });

  describe('applyAiRolePatch', () => {
    it('repoints a role to a { provider } pointer and grows the provider array without dropping other providers', () => {
      const base = {
        web_port: 3000,
        ai: {
          providers: [{ provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' }],
          roles: {
            manager: { provider: 'ollama' },
            workers: { provider: 'ollama' },
          },
        },
      };

      const out = applyAiRolePatch(base, 'manager', {
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        api_token: 'sk-1',
        model: 'gpt-4o-mini',
      });

      expect(out.web_port).toBe(3000);
      const ai = out.ai as Record<string, unknown>;
      expect(ai.providers).toEqual([
        { provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' },
        { provider: 'openai', base_url: 'https://api.openai.com/v1', api_token: 'sk-1', model: 'gpt-4o-mini' },
      ]);
      expect(ai.roles).toEqual({
        manager: { provider: 'openai' },
        workers: { provider: 'ollama' },
      });
      // input not mutated
      expect(base.ai.providers).toHaveLength(1);
    });

    it('stores num_ctx on the provider entry, not on the role pointer', () => {
      const base = {
        ai: {
          providers: [{ provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'qwen' }],
          roles: {
            manager: { provider: 'ollama' },
            workers: { provider: 'ollama' },
          },
        },
      };

      const out = applyAiRolePatch(base, 'workers', {
        provider: 'ollama',
        model: 'qwen',
        num_ctx: 32768,
      });
      const ai = out.ai as Record<string, unknown>;

      expect(ai.providers).toEqual([
        { provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'qwen', num_ctx: 32768 },
      ]);
      expect((ai.roles as Record<string, unknown>).workers).toEqual({ provider: 'ollama' });
    });

    it('stores num_ctx from a manager role patch on the provider entry', () => {
      const base = {
        ai: {
          providers: [{ provider: 'openrouter', base_url: '', api_token: 'sk-or', model: 'qwen' }],
          roles: { manager: { provider: 'openrouter' }, workers: { provider: 'openrouter' } },
        },
      };

      const out = applyAiRolePatch(base, 'manager', { provider: 'openrouter', model: 'qwen', num_ctx: 80000 });
      const ai = out.ai as Record<string, unknown>;

      expect(ai.providers).toEqual([
        { provider: 'openrouter', base_url: '', api_token: 'sk-or', model: 'qwen', num_ctx: 80000 },
      ]);
      expect((ai.roles as Record<string, unknown>).manager).toEqual({ provider: 'openrouter' });
    });
  });

  describe('resolveEmbed', () => {
    it('joins the ai.embed pointer to its provider entry creds', () => {
      const embed = resolveEmbed({
        providers: [
          { provider: 'ollama', base_url: 'http://host:11434', api_token: 'tok', model: 'gemma' },
        ],
        roles: { manager: { provider: 'ollama' }, workers: { provider: 'ollama' } },
        embed: { enabled: true, provider: 'ollama', model: 'nomic-embed-text' },
      });

      expect(embed).toEqual({
        ENABLED: true,
        PROVIDER: 'ollama',
        BASE_URL: 'http://host:11434',
        API_TOKEN: 'tok',
        MODEL: 'nomic-embed-text',
      });
    });

    it('defaults to disabled ollama / nomic-embed-text', () => {
      const embed = resolveEmbed({});
      expect(embed).toEqual({
        ENABLED: false,
        PROVIDER: 'ollama',
        BASE_URL: '',
        API_TOKEN: '',
        MODEL: 'nomic-embed-text',
      });
    });
  });

  describe('applyAiEmbedPatch', () => {
    it('sets ai.embed and upserts the provider creds without clobbering its chat model', () => {
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
      const ai = out.ai as Record<string, unknown>;

      expect(ai.embed).toEqual({ enabled: true, provider: 'ollama', model: 'nomic-embed-text' });
      // the ollama entry keeps its chat model — the embed model lives on ai.embed
      expect((ai.providers as { provider: string; model: string }[]).find((p) => p.provider === 'ollama')?.model).toBe('gemma');
      expect(ai.roles).toEqual({ manager: { provider: 'ollama' }, workers: { provider: 'openai' } });
    });

    it('keeps the existing enabled flag when the patch omits it', () => {
      const base = {
        ai: {
          providers: [{ provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' }],
          roles: { manager: { provider: 'ollama' }, workers: { provider: 'ollama' } },
          embed: { enabled: true, provider: 'ollama', model: 'nomic-embed-text' },
        },
      };

      const out = applyAiEmbedPatch(base, { provider: 'ollama', model: 'mxbai-embed-large' });
      const ai = out.ai as Record<string, unknown>;

      expect(ai.embed).toEqual({ enabled: true, provider: 'ollama', model: 'mxbai-embed-large' });
    });
  });

  describe('applyAiProviderPatch', () => {
    it('upserts the provider without touching either role pointer', () => {
      const base = {
        ai: {
          providers: [{ provider: 'ollama', base_url: 'http://host:11434', api_token: '', model: 'gemma' }],
          roles: {
            manager: { provider: 'ollama' },
            workers: { provider: 'ollama' },
          },
        },
      };

      const out = applyAiProviderPatch(base, {
        provider: 'nvidia',
        api_token: 'nv-key',
        model: 'meta/llama-3.3-70b-instruct',
      });
      const ai = out.ai as Record<string, unknown>;

      expect((ai.providers as { provider: string }[]).map((p) => p.provider)).toEqual(['ollama', 'nvidia']);
      expect(ai.roles).toEqual({
        manager: { provider: 'ollama' },
        workers: { provider: 'ollama' },
      });
    });
  });
});
