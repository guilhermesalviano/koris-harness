import { describe, it, expect } from 'vitest';
import { generateId } from '../../../src/utils/generate-id';

describe('generateId', () => {
  it('returns a 13-character lowercase hex string', () => {
    expect(generateId()).toMatch(/^[0-9a-f]{13}$/);
  });

  it('generates unique ids across many calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateId()));
    expect(ids.size).toBe(200);
  });

  it('does not contain hyphens', () => {
    expect(generateId()).not.toContain('-');
  });

  it('returns a string', () => {
    expect(typeof generateId()).toBe('string');
  });
});
