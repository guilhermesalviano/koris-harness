import { describe, it, expect } from 'vitest';
import { sanitizePrompt } from '../../../src/utils/prompt-sanitizer';

describe('sanitizePrompt', () => {
  it('drops duplicate lines keeping the first occurrence', () => {
    const result = sanitizePrompt('First line\nSecond line\nfirst line');

    expect(result.text).toBe('First line\nSecond line');
    expect(result.stats.dedupedLines).toBe(1);
  });

  it('drops consecutive duplicate lines', () => {
    const result = sanitizePrompt('hello\nhello\nworld');

    expect(result.text).toBe('hello\nworld');
    expect(result.stats.dedupedLines).toBe(1);
  });

  it('drops duplicate sentences within a line', () => {
    const result = sanitizePrompt('I went to the store. I went to the store. Then home.');

    expect(result.text).toBe('I went to the store. Then home.');
    expect(result.stats.dedupedSentences).toBe(1);
  });

  it('collapses repeated adjacent words', () => {
    const result = sanitizePrompt('I I want want to to go');

    expect(result.text).toBe('I want to go');
  });

  it('removes filler words without touching substrings', () => {
    const result = sanitizePrompt('I like coffee. Likely yes, belief is strong. Um, basically, just that.');

    expect(result.text).not.toContain('like');
    expect(result.text).not.toContain('Um');
    expect(result.text).not.toContain('basically');
    expect(result.text).not.toContain('just');
    expect(result.text).toContain('Likely');
    expect(result.text).toContain('belief');
    expect(result.stats.removedFillers).toBe(4);
  });

  it('removes multi-word fillers with surrounding commas', () => {
    const result = sanitizePrompt('you know, I mean, it is fine');

    expect(result.text).toBe('it is fine');
    expect(result.stats.removedFillers).toBe(2);
  });

  it('collapses whitespace and repeated punctuation', () => {
    const result = sanitizePrompt('  hello    world!!   \n\n  \nnext  line   ');

    expect(result.text).toBe('hello world!\nnext line');
  });

  it('respects a custom filler word list', () => {
    const result = sanitizePrompt('um okay', { fillerWords: ['okay'] });

    expect(result.text).toBe('um');
    expect(result.stats.removedFillers).toBe(1);
  });

  it('leaves text untouched when all knobs are disabled', () => {
    const input = 'Hello. Hello.\n\n\n';
    const result = sanitizePrompt(input, {
      collapseWhitespace: false,
      dedupeLines: false,
      dedupeSentences: false,
      dedupeRepeatedWords: false,
      fillerWords: [],
    });

    expect(result.text).toBe(input);
    expect(result.stats.dedupedLines).toBe(0);
    expect(result.stats.dedupedSentences).toBe(0);
    expect(result.stats.removedFillers).toBe(0);
  });

  it('reports accurate stats', () => {
    const result = sanitizePrompt('hello hello world world');

    expect(result.text).toBe('hello world');
    expect(result.stats.originalLength).toBe('hello hello world world'.length);
    expect(result.stats.sanitizedLength).toBe('hello world'.length);
    expect(result.stats.removedChars).toBe('hello hello world world'.length - 'hello world'.length);
    expect(result.stats.removedWords).toBe(2);
    expect(result.stats.percentReduced).toBe(52);
  });

  it('handles empty and whitespace-only input', () => {
    expect(sanitizePrompt('').text).toBe('');
    expect(sanitizePrompt('').stats.percentReduced).toBe(0);
    expect(sanitizePrompt('   \n\n  ').text).toBe('');
  });
});
