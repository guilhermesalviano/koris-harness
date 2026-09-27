import { describe, it, expect } from 'vitest';
import {
  isValidCronExpression,
  isEveryMinute,
  hasSpecificHour,
  matchesCron,
  isCronDue,
  nextCronFire,
  isOneTimeCron,
  isOneTimeBeatExpired,
} from '../../../src/utils/heartbeat';

describe('isValidCronExpression', () => {
  it('accepts standard 5-field cron', () => {
    expect(isValidCronExpression('0 9 * * 1')).toBe(true);
  });

  it('accepts all-wildcard expression', () => {
    expect(isValidCronExpression('* * * * *')).toBe(true);
  });

  it('accepts step expressions', () => {
    expect(isValidCronExpression('*/15 * * * *')).toBe(true);
  });

  it('accepts range expressions', () => {
    expect(isValidCronExpression('0-5 9 * * *')).toBe(true);
  });

  it('accepts list expressions', () => {
    expect(isValidCronExpression('0 9,17 * * *')).toBe(true);
  });

  it('rejects 4-field cron', () => {
    expect(isValidCronExpression('0 9 * *')).toBe(false);
  });

  it('rejects 6-field cron', () => {
    expect(isValidCronExpression('0 0 9 * * *')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidCronExpression('')).toBe(false);
  });

  it('accepts leading/trailing whitespace', () => {
    expect(isValidCronExpression('  0 9 * * 1  ')).toBe(true);
  });
});

describe('isEveryMinute', () => {
  it('returns true for "* * * * *"', () => {
    expect(isEveryMinute('* * * * *')).toBe(true);
  });

  it('returns true for "*/1 * * * *"', () => {
    expect(isEveryMinute('*/1 * * * *')).toBe(true);
  });

  it('returns false for "*/5 * * * *"', () => {
    expect(isEveryMinute('*/5 * * * *')).toBe(false);
  });

  it('returns false for specific minute', () => {
    expect(isEveryMinute('30 9 * * *')).toBe(false);
  });

  it('returns false for "*/30 * * * *"', () => {
    expect(isEveryMinute('*/30 * * * *')).toBe(false);
  });
});

describe('hasSpecificHour', () => {
  it('returns true when hour field is a number', () => {
    expect(hasSpecificHour('0 9 * * *')).toBe(true);
  });

  it('returns true when hour field is a range', () => {
    expect(hasSpecificHour('0 9-17 * * *')).toBe(true);
  });

  it('returns true when minute is fixed and hour is wildcard', () => {
    expect(hasSpecificHour('0 * * * *')).toBe(true);
  });

  it('returns true for */30 in minute field (valid repeat)', () => {
    expect(hasSpecificHour('*/30 * * * *')).toBe(true);
  });

  it('returns true for */15 in minute field', () => {
    expect(hasSpecificHour('*/15 * * * *')).toBe(true);
  });

  it('returns false for wildcard minute with wildcard hour', () => {
    expect(hasSpecificHour('* * * * *')).toBe(false);
  });

  it('returns true for wildcard minute with specific hour', () => {
    expect(hasSpecificHour('* 9 * * *')).toBe(true);
  });

  it('returns false for */1 in minute with wildcard hour', () => {
    expect(hasSpecificHour('*/1 * * * *')).toBe(false);
  });

  it('returns true for */1 in minute with specific hour', () => {
    expect(hasSpecificHour('*/1 9 * * *')).toBe(true);
  });
});

describe('matchesCron', () => {
  it('matches exact minute and hour', () => {
    const date = new Date(2024, 0, 15, 9, 0, 0); // local 09:00
    expect(matchesCron('0 9 * * *', date)).toBe(true);
  });

  it('does not match wrong minute', () => {
    const date = new Date(2024, 0, 15, 9, 5, 0);
    expect(matchesCron('0 9 * * *', date)).toBe(false);
  });

  it('does not match wrong hour', () => {
    const date = new Date(2024, 0, 15, 10, 0, 0);
    expect(matchesCron('0 9 * * *', date)).toBe(false);
  });

  it('matches wildcard on all fields', () => {
    expect(matchesCron('* * * * *', new Date())).toBe(true);
  });

  it('matches step expression */15 at minute 0', () => {
    const date = new Date(2024, 0, 15, 9, 0, 0);
    expect(matchesCron('*/15 * * * *', date)).toBe(true);
  });

  it('matches step expression */15 at minute 15', () => {
    const date = new Date(2024, 0, 15, 9, 15, 0);
    expect(matchesCron('*/15 * * * *', date)).toBe(true);
  });

  it('does not match step */15 at minute 7', () => {
    const date = new Date(2024, 0, 15, 9, 7, 0);
    expect(matchesCron('*/15 * * * *', date)).toBe(false);
  });

  it('matches range field', () => {
    const date = new Date(2024, 0, 15, 9, 3, 0);
    expect(matchesCron('0-5 9 * * *', date)).toBe(true);
  });

  it('does not match outside range', () => {
    const date = new Date(2024, 0, 15, 9, 6, 0);
    expect(matchesCron('0-5 9 * * *', date)).toBe(false);
  });

  it('matches comma-separated list', () => {
    const date = new Date(2024, 0, 15, 17, 0, 0);
    expect(matchesCron('0 9,17 * * *', date)).toBe(true);
  });

  it('matches range with step, start with step, and skips invalid steps', () => {
    const at15 = new Date(2024, 0, 15, 9, 15, 0);
    const at12 = new Date(2024, 0, 15, 9, 12, 0);
    const at35 = new Date(2024, 0, 15, 9, 35, 0);

    // Range with step: 10-30/5 matches 15, but not 12 or 35
    expect(matchesCron('10-30/5 9 * * *', at15)).toBe(true);
    expect(matchesCron('10-30/5 9 * * *', at12)).toBe(false);
    expect(matchesCron('10-30/5 9 * * *', at35)).toBe(false);

    // Start with step: 10/5 matches 15, but not 12
    expect(matchesCron('10/5 9 * * *', at15)).toBe(true);
    expect(matchesCron('10/5 9 * * *', at12)).toBe(false);

    // Invalid step: */0 or */abc continues and does not match
    expect(matchesCron('*/0 9 * * *', at15)).toBe(false);
    expect(matchesCron('*/abc 9 * * *', at15)).toBe(false);
  });
});

describe('isCronDue', () => {
  it('returns true when the wake minute matches the cron', () => {
    const now = new Date(2024, 0, 15, 9, 0, 0);
    const since = new Date(2024, 0, 15, 8, 55, 0);
    expect(isCronDue('0 9 * * *', now, since)).toBe(true);
  });

  it('returns true when the wake is within the grace window after the cron minute', () => {
    const now = new Date(2024, 0, 15, 9, 1, 0);
    const since = new Date(2024, 0, 15, 8, 55, 0);
    expect(isCronDue('0 9 * * *', now, since)).toBe(true);
  });

  it('returns true when the wake is exactly the cron minute after a long idle period', () => {
    const now = new Date(2024, 0, 15, 9, 0, 0);
    const since = new Date(2024, 0, 5, 8, 0, 0);
    expect(isCronDue('0 9 * * *', now, since)).toBe(true);
  });

  it('does not fire a task at a wake long after its scheduled minute (regression: 8:30 task firing at 19:04)', () => {
    const now = new Date(2024, 0, 15, 19, 4, 0);
    const since = new Date(2024, 0, 10, 0, 0, 0);
    expect(isCronDue('30 8 * * *', now, since)).toBe(false);
  });

  it('does not catch up on a cron that matched hours earlier', () => {
    const now = new Date(2024, 0, 15, 11, 0, 0);
    const since = new Date(2024, 0, 15, 8, 0, 0);
    expect(isCronDue('0 9 * * *', now, since)).toBe(false);
  });

  it('does not double-fire when the cron minute already ran just before now', () => {
    const now = new Date(2024, 0, 15, 8, 31, 0);
    const since = new Date(2024, 0, 15, 8, 30, 0);
    expect(isCronDue('30 8 * * *', now, since)).toBe(false);
  });

  it('returns false when cron did not fire near the wake', () => {
    const now = new Date(2024, 0, 15, 9, 5, 0);
    const since = new Date(2024, 0, 15, 9, 2, 0);
    expect(isCronDue('0 10 * * *', now, since)).toBe(false);
  });

  it('returns false when interval is zero (since === now)', () => {
    const now = new Date(2024, 0, 15, 9, 0, 0);
    const since = new Date(2024, 0, 15, 9, 0, 0);
    expect(isCronDue('0 9 * * *', now, since)).toBe(false);
  });

  it('returns false when since is after now', () => {
    const now = new Date(2024, 0, 15, 9, 0, 0);
    const since = new Date(2024, 0, 15, 10, 0, 0);
    expect(isCronDue('0 9 * * *', now, since)).toBe(false);
  });
});

describe('nextCronFire', () => {
  it('returns the next matching minute after the given date', () => {
    const from = new Date(2024, 0, 15, 8, 30, 0);
    const result = nextCronFire('0 9 * * *', from);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(9);
    expect(result!.getMinutes()).toBe(0);
    expect(result!.getDate()).toBe(15);
  });

  it('returns null when no match is found within 1 year', () => {
    const from = new Date(2024, 0, 15, 0, 0, 0);
    // A cron that will never match (Feb 30)
    const result = nextCronFire('0 0 30 2 *', from);
    expect(result).toBeNull();
  });

  it('returns the same day for a later time today', () => {
    const from = new Date(2024, 0, 15, 8, 0, 0);
    const result = nextCronFire('0 9 * * *', from);
    expect(result).not.toBeNull();
    expect(result!.getMonth()).toBe(0);
    expect(result!.getDate()).toBe(15);
  });

  it('skips minutes before "from" time', () => {
    const from = new Date(2024, 0, 15, 10, 0, 0);
    const result = nextCronFire('0 9 * * *', from);
    // 9:00 already passed, so next is next day at 9:00
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(9);
    expect(result!.getMinutes()).toBe(0);
    expect(result!.getDate()).toBe(16);
  });

  it('matches step expressions', () => {
    // */15 at 09:00 -> next match is at 09:15
    const from = new Date(2024, 0, 15, 9, 0, 0);
    const result = nextCronFire('*/15 * * * *', from);
    expect(result).not.toBeNull();
    expect(result!.getMinutes()).toBe(15);
  });

  it('matches day-of-week patterns', () => {
    // 0 9 * * 1 = Mondays at 9am
    const from = new Date(2024, 0, 14, 0, 0, 0); // Sunday
    const result = nextCronFire('0 9 * * 1', from);
    expect(result).not.toBeNull();
    expect(result!.getDay()).toBe(1); // Monday
    expect(result!.getHours()).toBe(9);
    expect(result!.getMinutes()).toBe(0);
  });

  it('returns null for null-like impossible expression', () => {
    // Every Feb 30 at 9am - impossible
    const from = new Date(2024, 0, 1, 0, 0, 0);
    const result = nextCronFire('0 9 30 2 *', from);
    expect(result).toBeNull();
  });
});

describe('isOneTimeCron', () => {
  it.each(['30 9 15 6 *', '0 0 1 1 *', '59 23 31 12 *', '0 12 29 2 *', ' 5 7 3 10 * '])('accepts a pinned date "%s"', (expr) => {
    expect(isOneTimeCron(expr)).toBe(true);
  });

  it.each([
    '0 9 * * *',     // every day
    '0 9 * * 1',     // every Monday
    '0 8 1 * *',     // every month
    '0 9 15 6 1',    // pinned day-of-week
    '0 9 1,15 6 *',  // list
    '0 9 1-5 6 *',   // range
    '*/30 9 15 6 *', // step
    '60 9 15 6 *',   // minute out of range
    '0 24 15 6 *',   // hour out of range
    '0 9 15 13 *',   // month out of range
    '0 9 0 6 *',     // day out of range
    '0 9 31 4 *',    // April has 30 days
    '0 9 30 2 *',    // February never has 30 days
    '0 9 15 6',      // too few fields
  ])('rejects "%s"', (expr) => {
    expect(isOneTimeCron(expr)).toBe(false);
  });
});

describe('isOneTimeBeatExpired', () => {
  const createdAt = new Date(2026, 8, 11, 8, 0);
  const cron = '30 9 11 9 *'; // Sep 11th, 9:30

  it('is not expired before its scheduled minute', () => {
    expect(isOneTimeBeatExpired(cron, createdAt, undefined, new Date(2026, 8, 11, 9, 0))).toBe(false);
  });

  it('is not expired within the grace window after its scheduled minute', () => {
    expect(isOneTimeBeatExpired(cron, createdAt, undefined, new Date(2026, 8, 11, 9, 31))).toBe(false);
  });

  it('is expired once its scheduled minute passed beyond the grace window', () => {
    expect(isOneTimeBeatExpired(cron, createdAt, undefined, new Date(2026, 8, 11, 9, 40))).toBe(true);
  });

  it('is expired once it has run', () => {
    expect(isOneTimeBeatExpired(cron, createdAt, new Date(2026, 8, 11, 9, 30), new Date(2026, 8, 11, 9, 30))).toBe(true);
  });

  it('treats a date already past this year as next year', () => {
    const lastYearDate = '0 9 5 1 *'; // Jan 5th, created in September
    expect(isOneTimeBeatExpired(lastYearDate, createdAt, undefined, new Date(2026, 11, 31))).toBe(false);
  });
});
