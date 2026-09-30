import { describe, expect, it } from 'vitest';
import { collectSettingsPayloadErrors, buildSettingsUpdate } from '../../../src/dashboard/settings-payload';

describe('dashboard settings payload', () => {
  it.each([
    { web_port: true }, { log_level: 1 }, { gateway_host: 1 },
    { ai: null }, { skills: [] }, { skills: { limit: true } }, { channels: 'text' }, { personal_information: [] },
    { ai: { manager: null } }, { ai: { workers: { model: 42 } } },
    { ai: { embed: { enabled: 'false' } } },
  ])('rejects settings that would corrupt the persisted config: %j', (patch) => {
    expect(collectSettingsPayloadErrors(patch)).not.toEqual([]);
  });

  it('splits live channel settings while retaining unrelated core settings', () => {
    const current = { channels: { defaults: { enabled: false } }, personal_information: { old: 'remove' } };
    const patch = { channels: { defaults: { timeout: 5 }, whatsapp: { whitelist: 'user' } }, personal_information: {} };
    const update = buildSettingsUpdate(current, patch, ['whatsapp']);
    expect(update.settings).toEqual({ channels: { defaults: { enabled: false, timeout: 5 } }, personal_information: {} });
    expect(update.channelConfigPatches).toEqual([{ name: 'whatsapp', patch: { whitelist: 'user' } }]);
    expect(current.personal_information).toEqual({ old: 'remove' });
  });

  it('keeps the stored context size when the UI sends an empty optional field', () => {
    const current = { ai: { providers: [{ provider: 'ollama', model: 'local', num_ctx: 16384 }] } };
    const { settings } = buildSettingsUpdate(current, { ai: { provider: { provider: 'ollama', num_ctx: '' } } }, []);
    expect((settings.ai as { providers: { num_ctx: number }[] }).providers[0].num_ctx).toBe(16384);
  });
});
