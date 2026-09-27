import { describe, it, expect } from 'vitest';
import { Memory } from '../../../src/entities/memory';

describe('Memory entity', () => {
  const base = { sessionId: 'sess-1', type: 'fact' as const, content: 'sky is blue' };

  it('assigns provided id', () => {
    expect(new Memory({ ...base, id: 'fixed' }).id).toBe('fixed');
  });

  it('generates id when omitted', () => {
    expect(new Memory(base).id).toMatch(/^[0-9a-f]{13}$/);
  });

  it('stores sessionId', () => {
    expect(new Memory(base).sessionId).toBe('sess-1');
  });

  it('stores type', () => {
    expect(new Memory(base).type).toBe('fact');
  });

  it('accepts all memory types', () => {
    const types = ['fact', 'summary', 'observation', 'decision'] as const;
    for (const type of types) {
      expect(new Memory({ ...base, type }).type).toBe(type);
    }
  });

  it('stores content', () => {
    expect(new Memory(base).content).toBe('sky is blue');
  });

  it('stores optional embedding', () => {
    expect(new Memory({ ...base, embedding: '[0.1,0.2]' }).embedding).toBe('[0.1,0.2]');
  });

  it('embedding is undefined when not provided', () => {
    expect(new Memory(base).embedding).toBeUndefined();
  });

  it('stores optional tags', () => {
    expect(new Memory({ ...base, tags: 'nature, sky' }).tags).toBe('nature, sky');
  });

  it('tags is undefined when not provided', () => {
    expect(new Memory(base).tags).toBeUndefined();
  });

  it('stores optional importance', () => {
    expect(new Memory({ ...base, importance: 5 }).importance).toBe(5);
  });

  it('importance is undefined when not provided', () => {
    expect(new Memory(base).importance).toBeUndefined();
  });

  it('defaults createdAt to current time', () => {
    const before = new Date();
    expect(new Memory(base).createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('stores provided createdAt', () => {
    const d = new Date('2024-01-01T00:00:00Z');
    expect(new Memory({ ...base, createdAt: d }).createdAt).toEqual(d);
  });

  it('two memories with same content get distinct ids', () => {
    const a = new Memory(base);
    const b = new Memory(base);
    expect(a.id).not.toBe(b.id);
  });
});
