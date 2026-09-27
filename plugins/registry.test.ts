import { describe, expect, it } from 'vitest';
import { ExtensionPoint, PluginRegistry } from './registry';

describe('PluginRegistry', () => {
  it('collects everything registered under a point', () => {
    const point = new ExtensionPoint<string>('test.point');
    const registry = new PluginRegistry();

    registry.extend(point, 'a');
    registry.extend(point, 'b');

    expect(registry.collect(point)).toEqual(['a', 'b']);
  });

  it('returns an empty array for a point nothing was registered under', () => {
    const point = new ExtensionPoint<string>('unused.point');
    const registry = new PluginRegistry();

    expect(registry.collect(point)).toEqual([]);
  });

  it('extend returns a disposer that removes exactly that registration', () => {
    const point = new ExtensionPoint<string>('test.point');
    const registry = new PluginRegistry();

    registry.extend(point, 'a');
    const disposeB = registry.extend(point, 'b');
    registry.extend(point, 'c');

    disposeB();

    expect(registry.collect(point)).toEqual(['a', 'c']);
  });

  it('calling a disposer twice is a no-op the second time', () => {
    const point = new ExtensionPoint<string>('test.point');
    const registry = new PluginRegistry();

    const dispose = registry.extend(point, 'a');
    dispose();
    dispose();

    expect(registry.collect(point)).toEqual([]);
  });

  it('collect returns a defensive copy — mutating the result does not affect the registry', () => {
    const point = new ExtensionPoint<string>('test.point');
    const registry = new PluginRegistry();
    registry.extend(point, 'a');

    const result = registry.collect(point);
    result.push('b');

    expect(registry.collect(point)).toEqual(['a']);
  });
});
