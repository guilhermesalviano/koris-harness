import { describe, expect, it } from 'vitest';
import { chatSeparatorLabel, sameDay, SEPARATOR_GAP_MS } from './date';

// Local-time constructors, and an explicit `now`, so the suite does not depend
// on the machine's timezone. Exact formatted times are locale-dependent, so the
// assertions look at the day word rather than the clock.
const NOW = new Date(2026, 8, 5, 18, 0).getTime(); // Sat Sep 5 2026, 6pm
const at = (...args: [number, number, number, number?, number?]) => new Date(...args).getTime();

const DAY_WORDS = /^(Today|Yesterday|[A-Z][a-z]{2} \d)/;

describe('sameDay', () => {
  it('compares calendar days, not elapsed time', () => {
    expect(sameDay(at(2026, 8, 5, 0, 1), at(2026, 8, 5, 23, 59))).toBe(true);
    expect(sameDay(at(2026, 8, 5, 23, 59), at(2026, 8, 6, 0, 1))).toBe(false);
  });
});

describe('chatSeparatorLabel', () => {
  it('always labels the first message, with its day', () => {
    const label = chatSeparatorLabel(at(2026, 8, 5, 14, 0), undefined, NOW);

    expect(label).toMatch(DAY_WORDS);
    expect(label?.startsWith('Today')).toBe(true);
  });

  it('shows nothing for messages a few minutes apart', () => {
    expect(chatSeparatorLabel(at(2026, 8, 5, 14, 3), at(2026, 8, 5, 14, 0), NOW)).toBeNull();
  });

  it('shows nothing right up to the gap threshold', () => {
    const prev = at(2026, 8, 5, 14, 0);
    expect(chatSeparatorLabel(prev + SEPARATOR_GAP_MS, prev, NOW)).toBeNull();
    expect(chatSeparatorLabel(prev + SEPARATOR_GAP_MS + 1, prev, NOW)).not.toBeNull();
  });

  it('drops the day word for a later separator on the same day', () => {
    const label = chatSeparatorLabel(at(2026, 8, 5, 16, 40), at(2026, 8, 5, 14, 0), NOW);

    expect(label).not.toBeNull();
    expect(label).not.toMatch(DAY_WORDS);
  });

  it('breaks on a day change even when the gap is small', () => {
    const label = chatSeparatorLabel(at(2026, 8, 5, 0, 2), at(2026, 8, 4, 23, 57), NOW);

    expect(label?.startsWith('Today')).toBe(true);
  });

  it('names yesterday', () => {
    const label = chatSeparatorLabel(at(2026, 8, 4, 21, 12), at(2026, 8, 3, 9, 0), NOW);

    expect(label?.startsWith('Yesterday')).toBe(true);
  });

  it('falls back to a date for older days, without the year in the current year', () => {
    const label = chatSeparatorLabel(at(2026, 8, 1, 9, 0), at(2026, 7, 30, 9, 0), NOW);

    expect(label?.startsWith('Today')).toBe(false);
    expect(label?.startsWith('Yesterday')).toBe(false);
    expect(label).not.toContain('2026');
  });

  it('includes the year for a different year', () => {
    const label = chatSeparatorLabel(at(2025, 11, 24, 9, 0), at(2025, 11, 23, 9, 0), NOW);

    expect(label).toContain('2025');
  });

  it('ignores unparseable timestamps rather than rendering "Invalid Date"', () => {
    expect(chatSeparatorLabel(NaN, at(2026, 8, 5, 14, 0), NOW)).toBeNull();
    expect(chatSeparatorLabel(at(2026, 8, 5, 14, 0), NaN, NOW)).not.toBeNull();
  });
});
