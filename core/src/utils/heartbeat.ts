const CRON_REGEX = /^(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)$/;

export function isValidCronExpression(expr: string): boolean {
  return CRON_REGEX.test(expr.trim());
}

/**
 * Checks whether a single cron field value (e.g. "5", "*", "0-5", "* /15", "1,3,5") matches
 * the given numeric value.
 */
function matchesCronField(field: string, value: number): boolean {
  if (field === '*') return true;

  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [rangeStr, stepStr] = part.split('/');
      const step = Number(stepStr);
      if (isNaN(step) || step <= 0) continue;

      if (rangeStr === '*') {
        if (value % step === 0) return true;
      } else if (rangeStr.includes('-')) {
        const [lo, hi] = rangeStr.split('-').map(Number);
        if (value >= lo && value <= hi && (value - lo) % step === 0) return true;
      } else {
        const start = Number(rangeStr);
        if (value >= start && (value - start) % step === 0) return true;
      }
    } else if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number);
      if (value >= lo && value <= hi) return true;
    } else {
      if (Number(part) === value) return true;
    }
  }

  return false;
}

/**
 * Returns true for patterns whose minute field schedules execution every minute.
 */
export function isEveryMinute(expr: string): boolean {
  const [minuteF] = expr.trim().split(/\s+/);
  return minuteF === '*' || minuteF === '*/1';
}

/**
 * Returns true for any schedule that does not use an every-minute minute field,
 * or when such a minute field is constrained to a specific hour.
 */
export function hasSpecificHour(expr: string): boolean {
  const [minuteF, hourF] = expr.trim().split(/\s+/);
  if (minuteF !== '*' && minuteF !== '*/1') return true;
  return hourF !== '*';
}


const MAX_DAY_OF_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Returns true when the expression pins one exact moment of the year — plain
 * numbers for minute, hour, day-of-month and month, and "*" for day-of-week
 * (e.g. "30 9 15 6 *"). That is the only shape a one-time beat may use: any
 * wildcard, list, range or step would make it fire more than once.
 */
export function isOneTimeCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5 || fields[4] !== '*') return false;
  if (!fields.slice(0, 4).every((field) => /^\d+$/.test(field))) return false;

  const [minute, hour, day, month] = fields.slice(0, 4).map(Number);
  return minute <= 59 && hour <= 23 && month >= 1 && month <= 12 && day >= 1 && day <= MAX_DAY_OF_MONTH[month - 1];
}

/**
 * Returns true when "date" falls within the 5-field cron schedule.
 * Field order: minute hour day-of-month month day-of-week (0=Sun ... 6=Sat)
 */
export function matchesCron(expr: string, date: Date): boolean {
  const [minuteF, hourF, domF, monthF, dowF] = expr.trim().split(/\s+/);
  return (
    matchesCronField(minuteF, date.getMinutes()) &&
    matchesCronField(hourF,   date.getHours()) &&
    matchesCronField(domF,    date.getDate()) &&
    matchesCronField(monthF,  date.getMonth() + 1) &&
    matchesCronField(dowF,    date.getDay())
  );
}

// Tolerance for scheduling jitter (event-loop delay) when the runner wakes up.
// Tasks are only considered due within a few minutes of their scheduled minute,
// so a missed occurrence is skipped instead of firing at the wrong hour.
const GRACE_MS = 2 * 60_000;

/**
 * Returns true if the cron expression has a scheduled minute at or shortly before
 * "now" (but strictly after "since"). This ensures a task only fires at its
 * scheduled hour and is never executed late as a catch-up for missed occurrences.
 */
export function isCronDue(expr: string, now: Date, since: Date): boolean {
  const nowMs = now.getTime();
  const start = Math.max(since.getTime() + 60_000, nowMs - GRACE_MS);

  for (let t = start; t <= nowMs; t += 60_000) {
    if (matchesCron(expr, new Date(t))) return true;
  }
  return false;
}

/**
 * Returns the next Date strictly after `from` that matches the cron expression.
 * All returned times are aligned to minute boundaries (zero seconds, zero ms)
 * to prevent scheduling drift with short-interval crons like *&#47;5.
 * Returns null if no match is found within a reasonable look-ahead window (1 year).
 */
export function nextCronFire(expr: string, from: Date): Date | null {
  const lookAheadMs = 365 * 24 * 60 * 60_000; // 1 year
  // Round up to the next whole minute so we always start from a clean boundary
  const fromMs = Math.ceil(from.getTime() / 60_000) * 60_000;
  const maxMs = fromMs + lookAheadMs;

  for (let t = fromMs + 60_000; t <= maxMs; t += 60_000) {
    if (matchesCron(expr, new Date(t))) return new Date(t);
  }
  return null;
}

/**
 * Returns true when a one-time beat can no longer fire: it already ran, or its
 * only occurrence (the first cron match after creation) passed more than the
 * grace window ago — e.g. the process was down at that minute. `isCronDue`
 * never catches up, so keeping it around would make it fire a year late.
 */
export function isOneTimeBeatExpired(expr: string, createdAt: Date, lastRun: Date | undefined, now: Date): boolean {
  if (lastRun) return true;
  const firstFire = nextCronFire(expr, createdAt);
  return !firstFire || firstFire.getTime() < now.getTime() - GRACE_MS;
}
