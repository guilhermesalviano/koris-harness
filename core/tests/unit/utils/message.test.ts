import { describe, it, expect } from 'vitest';
import { toSafeMessage, previewMessage } from '../../../src/utils/message';

describe('toSafeMessage', () => {
  it('returns string as-is', () => {
    expect(toSafeMessage('hello')).toBe('hello');
  });

  it('returns empty string for null', () => {
    expect(toSafeMessage(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(toSafeMessage(undefined)).toBe('');
  });

  it('converts number to string', () => {
    expect(toSafeMessage(42)).toBe('42');
  });

  it('converts boolean to string', () => {
    expect(toSafeMessage(true)).toBe('true');
  });

  it('converts object via String()', () => {
    expect(toSafeMessage({ toString: () => 'custom' })).toBe('custom');
  });

  it('returns empty string when String() throws', () => {
    const input = {
      toString() {
        throw new Error('boom');
      },
    };
    expect(toSafeMessage(input)).toBe('');
  });
});

describe('previewMessage', () => {
  it('returns short messages unchanged', () => {
    expect(previewMessage('hello world')).toBe('hello world');
  });

  it('trims leading/trailing whitespace', () => {
    expect(previewMessage('  hello  ')).toBe('hello');
  });

  it('collapses internal whitespace', () => {
    expect(previewMessage('hello   world')).toBe('hello world');
  });

  it('truncates messages longer than maxLen', () => {
    const long = 'a'.repeat(300);
    const result = previewMessage(long);
    expect(result).toHaveLength(201); // 200 chars + ellipsis
    expect(result.endsWith('…')).toBe(true);
  });

  it('respects custom maxLen', () => {
    const result = previewMessage('hello world', 5);
    expect(result).toBe('hello…');
  });

  it('returns message exactly at maxLen without truncation', () => {
    const exact = 'a'.repeat(200);
    const result = previewMessage(exact);
    expect(result).toBe(exact);
    expect(result.endsWith('…')).toBe(false);
  });
});
