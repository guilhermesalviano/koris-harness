/**
 * Shared cron-expression validation, used by both `set-beat` and
 * `update-beat`. Pure/dependency-free — a copy of the subset of
 * `core/src/utils/heartbeat.ts` those two plugins actually need (the runner's
 * scheduling logic — `matchesCron`, `isCronDue`, `nextCronFire` — stays in
 * core, since it's not a tool concern).
 */

const CRON_REGEX = /^(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)$/;

export function isValidCronExpression(expr: string): boolean {
  return CRON_REGEX.test(expr.trim());
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
