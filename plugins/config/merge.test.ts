import { describe, expect, it } from 'vitest';
import { isPlainObject, mergeConfigPatch } from './merge';

describe('mergeConfigPatch', () => {
  it('keeps prototype-shaped JSON keys as data without inheriting their values', () => {
    const patch = JSON.parse('{"__proto__":{"enabled":true},"nested":{"__proto__":{"token":"secret"}}}');
    const result = mergeConfigPatch({ nested: {} }, patch);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.enabled).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(result.nested)).toBe(Object.prototype);
    expect((result.nested as Record<string, unknown>).token).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result))).toEqual(patch);
  });

  it('does not merge inherited properties into a patch', () => {
    const result = mergeConfigPatch({}, { constructor: { label: 'configured' } });
    expect(result.constructor).toEqual({ label: 'configured' });
  });

  it('recognizes only plain records', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    for (const value of [null, [], new Date(), new Map(), 'text']) {
      expect(isPlainObject(value)).toBe(false);
    }
  });
});
