import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins conditional class values', () => {
    expect(cn('a', false && 'b', undefined, ['c', null], { d: true, e: false })).toBe('a c d');
  });

  it('lets a later utility override an earlier one', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('treats the custom type scale as font sizes, not colours', () => {
    // The reason cn exists: without the theme extension tailwind-merge reads
    // `text-body` as a colour and drops it when merged with `text-txt-2`.
    expect(cn('text-body', 'text-txt-2')).toBe('text-body text-txt-2');
    expect(cn('text-body', 'text-title')).toBe('text-title');
  });

  it('resolves custom colour, radius and shadow scales', () => {
    expect(cn('text-txt-2', 'text-accent-2')).toBe('text-accent-2');
    expect(cn('rounded-control', 'rounded-card')).toBe('rounded-card');
    expect(cn('shadow-panel', 'shadow-pop')).toBe('shadow-pop');
  });

  it('keeps distinct properties that share a prefix', () => {
    expect(cn('border-strong', 'bg-bg-3')).toBe('border-strong bg-bg-3');
  });
});
