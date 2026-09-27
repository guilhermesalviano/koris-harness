import { describe, expect, it } from 'vitest';
import { buildProviderEditPatch, validateProviderDraft, type ProviderDraft } from './provider-draft';

const profile: ProviderDraft = { provider: 'ollama', model: 'chat-model', baseUrl: '', apiToken: '', numCtx: '16384', enabled: false };

describe('provider automatic edits', () => {
  it('patches only edited fields so a shared provider model is not overwritten by another role', () => {
    expect(buildProviderEditPatch('workers', { ...profile, apiToken: 'new-token' }, profile))
      .toEqual({ ai: { workers: { provider: 'ollama', api_token: 'new-token' } } });
  });

  it('activates a selected provider with its stored configuration and preserves its token', () => {
    expect(buildProviderEditPatch('manager', { ...profile, provider: 'openai', model: 'saved-model', baseUrl: 'https://example.com/v1' }, profile))
      .toEqual({ ai: { manager: { provider: 'openai', model: 'saved-model', base_url: 'https://example.com/v1', num_ctx: 16384 } } });
  });

  it('updates the separate embedding model without touching the chat model', () => {
    expect(buildProviderEditPatch('embed', { ...profile, model: 'embedding-model', enabled: true }, profile))
      .toEqual({ ai: { embed: { provider: 'ollama', model: 'embedding-model', enabled: true } } });
  });

  it('requires valid configuration before activating a provider', () => {
    expect(validateProviderDraft({ ...profile, model: '' }, false)).toMatch(/model/);
    expect(validateProviderDraft({ ...profile, baseUrl: 'broken' }, false)).toMatch(/URL/);
    expect(validateProviderDraft({ ...profile, numCtx: '511' }, false)).toMatch(/512/);
    expect(validateProviderDraft({ ...profile, numCtx: '32768' }, false)).toBeNull();
  });
});
