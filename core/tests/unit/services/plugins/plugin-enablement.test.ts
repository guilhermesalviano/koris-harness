import { describe, it, expect, vi } from 'vitest';
import type { IPluginSettingsRepository, PluginFamily } from '../../../../src/repositories/plugin-settings';
import type { ILogger } from '../../../../src/infrastructure/logger';

const { resolvePluginDir, loadPluginConfigFile } = vi.hoisted(() => ({
  resolvePluginDir: vi.fn((name: string) => `/fake/plugins/${name}`),
  loadPluginConfigFile: vi.fn(() => ({}) as Record<string, unknown>),
}));

vi.mock('../../../../../plugins/config/loader', () => ({
  resolvePluginDir,
  loadPluginConfigFile,
}));

import {
  defaultPluginEnabled,
  resolvePluginEnabled,
  migrateLegacyPluginEnabledFlags,
} from '../../../../src/services/plugins/plugin-enablement';

function makeRepo(stored: Partial<Record<string, boolean>> = {}): IPluginSettingsRepository {
  return {
    getEnabled: vi.fn((family: PluginFamily, name: string) => {
      const key = `${family}/${name}`;
      return key in stored ? (stored[key] as boolean) : null;
    }),
    setEnabled: vi.fn(),
    getAll: vi.fn(() => []),
  };
}

function makeLogger(): ILogger {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

describe('defaultPluginEnabled', () => {
  it('defaults channels to disabled', () => {
    expect(defaultPluginEnabled('channels', 'telegram')).toBe(false);
    expect(defaultPluginEnabled('channels', 'whatsapp')).toBe(false);
  });

  it('defaults tools to enabled, except create-tool', () => {
    expect(defaultPluginEnabled('tools', 'curl-request')).toBe(true);
    expect(defaultPluginEnabled('tools', 'create-tool')).toBe(false);
  });
});

describe('resolvePluginEnabled', () => {
  it('falls back to the code default when no DB row exists', () => {
    const repo = makeRepo();
    expect(resolvePluginEnabled(repo, 'tools', 'curl-request')).toBe(true);
    expect(resolvePluginEnabled(repo, 'channels', 'telegram')).toBe(false);
  });

  it('prefers the stored DB value over the code default', () => {
    const repo = makeRepo({ 'tools/curl-request': false, 'channels/telegram': true });
    expect(resolvePluginEnabled(repo, 'tools', 'curl-request')).toBe(false);
    expect(resolvePluginEnabled(repo, 'channels', 'telegram')).toBe(true);
  });
});

describe('migrateLegacyPluginEnabledFlags', () => {
  it('seeds the DB from a legacy config.yml enabled key when no row exists yet', () => {
    loadPluginConfigFile.mockReturnValue({ enabled: false });
    const repo = makeRepo();
    const logger = makeLogger();

    migrateLegacyPluginEnabledFlags(repo, [{ family: 'tools', name: 'search-engine' }], logger);

    expect(repo.setEnabled).toHaveBeenCalledWith('tools', 'search-engine', false);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('migrated legacy enabled=false'));
  });

  it('is idempotent: does nothing when a DB row already exists', () => {
    const repo = makeRepo({ 'tools/search-engine': true });
    const logger = makeLogger();

    migrateLegacyPluginEnabledFlags(repo, [{ family: 'tools', name: 'search-engine' }], logger);

    expect(repo.setEnabled).not.toHaveBeenCalled();
  });

  it('does nothing when the legacy file has no explicit enabled key', () => {
    loadPluginConfigFile.mockReturnValue({});
    const repo = makeRepo();
    const logger = makeLogger();

    migrateLegacyPluginEnabledFlags(repo, [{ family: 'tools', name: 'issue' }], logger);

    expect(repo.setEnabled).not.toHaveBeenCalled();
  });
});
