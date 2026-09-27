import { describe, it, expect } from 'vitest';
import { PluginCatalogSingleton } from '../../../../src/services/plugins/plugin-catalog-singleton';

// Order matters: module-level static state persists across `it()` blocks in
// this file, so the "nothing set yet" case must run first.
describe('PluginCatalogSingleton', () => {
  it('getExistingInstance returns [] before anything has been set', () => {
    expect(PluginCatalogSingleton.getExistingInstance()).toEqual([]);
  });

  it('getInstance sets the identities on the first call', () => {
    const boot = [{ family: 'tools' as const, name: 'curl-request' }];
    expect(PluginCatalogSingleton.getInstance(boot)).toBe(boot);
    expect(PluginCatalogSingleton.getExistingInstance()).toEqual(boot);
  });

  it('getInstance ignores a later call and keeps the first identities', () => {
    PluginCatalogSingleton.getInstance([{ family: 'tools', name: 'ignored' }]);

    expect(PluginCatalogSingleton.getExistingInstance()).toEqual([{ family: 'tools', name: 'curl-request' }]);
  });

  it('append adds to the cached identities without dropping the existing ones', () => {
    PluginCatalogSingleton.append([{ family: 'tools', name: 'weather' }]);

    expect(PluginCatalogSingleton.getExistingInstance()).toEqual([
      { family: 'tools', name: 'curl-request' },
      { family: 'tools', name: 'weather' },
    ]);
  });

  it('append can be called multiple times, accumulating each time', () => {
    PluginCatalogSingleton.append([{ family: 'tools', name: 'issue' }]);

    expect(PluginCatalogSingleton.getExistingInstance().map((i) => i.name)).toEqual(['curl-request', 'weather', 'issue']);
  });
});
