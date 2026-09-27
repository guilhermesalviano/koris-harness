import { describe, it, expect } from 'vitest';
import { ToolPluginsSingleton } from '../../../../src/services/tools/registry-singleton';
import type { ToolDefinition } from '../../../../../plugins/tools/contracts';

function makeDef(name: string): ToolDefinition {
  return { name } as ToolDefinition;
}

// Order matters here: ToolPluginsSingleton holds module-level static state
// that persists across `it()` blocks within this file, so the "nothing set
// yet" case must run before anything else touches it.
describe('ToolPluginsSingleton', () => {
  it('getExistingInstance returns [] before anything has been set', () => {
    expect(ToolPluginsSingleton.getExistingInstance()).toEqual([]);
  });

  it('getInstance sets the definitions on the first call', () => {
    const first = [makeDef('curl-request')];
    expect(ToolPluginsSingleton.getInstance(first)).toBe(first);
    expect(ToolPluginsSingleton.getExistingInstance()).toBe(first);
  });

  it('getInstance ignores a later call and keeps the first definitions', () => {
    const second = [makeDef('issue')];
    expect(ToolPluginsSingleton.getInstance(second)).not.toBe(second);
    expect(ToolPluginsSingleton.getExistingInstance()[0]!.name).toBe('curl-request');
  });

  it('replace swaps the cached definitions immediately, unlike getInstance', () => {
    const hotLoaded = [makeDef('curl-request'), makeDef('weather')];
    ToolPluginsSingleton.replace(hotLoaded);

    expect(ToolPluginsSingleton.getExistingInstance()).toBe(hotLoaded);
  });

  it('getInstance after a replace() still leaves the replaced value in place', () => {
    const ignored = [makeDef('ignored')];
    ToolPluginsSingleton.getInstance(ignored);

    expect(ToolPluginsSingleton.getExistingInstance().map((d) => d.name)).toEqual(['curl-request', 'weather']);
  });
});
