import { describe, it, expect } from 'vitest';
import { replacePlaceholders } from '../../../src/utils/prompt';

describe('replacePlaceholders', () => {
  it('replaces a single placeholder', () => {
    const result = replacePlaceholders('Hello, {name}!', { name: 'World' });
    expect(result).toBe('Hello, World!');
  });

  it('replaces multiple placeholders', () => {
    const result = replacePlaceholders('{greeting}, {name}!', { greeting: 'Hi', name: 'Alice' });
    expect(result).toBe('Hi, Alice!');
  });

  it('replaces all occurrences of the same placeholder', () => {
    const result = replacePlaceholders('{v1} + {v1} = 2{v1}', { v1: '1' });
    expect(result).toBe('1 + 1 = 21');
  });

  it('returns the original string when no placeholders match', () => {
    const result = replacePlaceholders('No placeholders here', { name: 'test' });
    expect(result).toBe('No placeholders here');
  });

  it('returns the original string when values is empty', () => {
    const result = replacePlaceholders('Hello, {name}!', {});
    expect(result).toBe('Hello, {name}!');
  });

  it('handles empty content string', () => {
    const result = replacePlaceholders('', { name: 'test' });
    expect(result).toBe('');
  });
});
