import { describe, it, expect, vi } from 'vitest';
import { PluginSettingsRepository } from '../../../src/repositories/plugin-settings';

function makeDb() {
  return { run: vi.fn(), get: vi.fn(), query: vi.fn() };
}

describe('PluginSettingsRepository', () => {
  it('getEnabled returns null when no row exists', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repo = new PluginSettingsRepository(db as never);

    expect(repo.getEnabled('tools', 'curl-request')).toBeNull();
  });

  it('getEnabled maps the stored 0/1 to a boolean', () => {
    const db = makeDb();
    db.get.mockReturnValue({ enabled: 0 });
    const repo = new PluginSettingsRepository(db as never);

    expect(repo.getEnabled('tools', 'curl-request')).toBe(false);
  });

  it('setEnabled upserts with the enabled flag as 0/1', () => {
    const db = makeDb();
    const repo = new PluginSettingsRepository(db as never);

    repo.setEnabled('channels', 'telegram', true);

    expect(db.run).toHaveBeenCalledTimes(1);
    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('INSERT INTO plugin_settings');
    expect(sql).toContain('ON CONFLICT(family, name) DO UPDATE');
    expect(params).toEqual(['channels', 'telegram', 1]);
  });

  it('getAll maps every row to a PluginSettingRecord', () => {
    const db = makeDb();
    db.query.mockReturnValue([
      { family: 'tools', name: 'curl-request', enabled: 1 },
      { family: 'channels', name: 'telegram', enabled: 0 },
    ]);
    const repo = new PluginSettingsRepository(db as never);

    expect(repo.getAll()).toEqual([
      { family: 'tools', name: 'curl-request', enabled: true },
      { family: 'channels', name: 'telegram', enabled: false },
    ]);
  });
});
