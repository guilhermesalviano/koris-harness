import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConfig, reloadConfig, writeSettingsFile, mergeSettingsPayload, loadCurrentOrExampleSettings } = vi.hoisted(() => ({
  mockConfig: { ALLOWED_DOMAINS: [] as string[] },
  reloadConfig: vi.fn(),
  writeSettingsFile: vi.fn().mockReturnValue('/tmp/koris.json'),
  mergeSettingsPayload: vi.fn((base: Record<string, unknown>, patch: Record<string, unknown>) => ({ ...base, ...patch })),
  loadCurrentOrExampleSettings: vi.fn().mockReturnValue({ allowed_domains: [] }),
}));

vi.mock('../../../../src/config', () => ({ config: mockConfig, reloadConfig }));
vi.mock('../../../../src/config/settings-writer', () => ({
  writeSettingsFile,
  mergeSettingsPayload,
  loadCurrentOrExampleSettings,
}));

import { addAllowedDomain } from '../../../../src/services/security/allowed-domains';

describe('addAllowedDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.ALLOWED_DOMAINS = [];
  });

  it('rejects empty input without touching the settings file', () => {
    const result = addAllowedDomain('   ');
    expect(result.ok).toBe(false);
    expect(writeSettingsFile).not.toHaveBeenCalled();
  });

  it('rejects an unparseable domain', () => {
    expect(addAllowedDomain('not a domain !!').ok).toBe(false);
    expect(writeSettingsFile).not.toHaveBeenCalled();
  });

  it('normalises, appends and reloads for a new domain', () => {
    reloadConfig.mockImplementation(() => {
      mockConfig.ALLOWED_DOMAINS = ['api.example.com'];
    });

    const result = addAllowedDomain('https://API.example.com/path');

    expect(result).toMatchObject({ ok: true, added: true, hostname: 'api.example.com' });
    expect(mergeSettingsPayload).toHaveBeenCalledWith({ allowed_domains: [] }, { allowed_domains: ['api.example.com'] });
    expect(writeSettingsFile).toHaveBeenCalledTimes(1);
    expect(reloadConfig).toHaveBeenCalledTimes(1);
  });

  it('is idempotent for a domain already on the list', () => {
    mockConfig.ALLOWED_DOMAINS = ['example.com'];

    const result = addAllowedDomain('example.com');

    expect(result).toMatchObject({ ok: true, added: false, hostname: 'example.com' });
    expect(writeSettingsFile).not.toHaveBeenCalled();
    expect(reloadConfig).not.toHaveBeenCalled();
  });
});
