/** A pause longer than this between two messages earns a separator. */
export const SEPARATOR_GAP_MS = 60 * 60 * 1000;

/** Whether two instants fall on the same calendar day, in the viewer's timezone. */
export function sameDay(a: number | Date, b: number | Date): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayWord(at: number, now: number): string {
  if (sameDay(at, now)) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(at, yesterday)) return 'Yesterday';

  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * The separator to show above a message, or null when it follows its predecessor
 * closely enough to need none.
 *
 * The day is named only when it changes — the first message of a thread, or the
 * first after midnight — so a long session reads "Today 2:14 PM" … "4:40 PM".
 */
export function chatSeparatorLabel(at: number, prevAt?: number, now: number = Date.now()): string | null {
  if (!Number.isFinite(at)) return null;

  if (prevAt === undefined || !Number.isFinite(prevAt)) {
    return `${dayWord(at, now)} ${timeOf(at)}`;
  }

  // A day change always breaks the thread, however small the gap.
  if (!sameDay(at, prevAt)) {
    return `${dayWord(at, now)} ${timeOf(at)}`;
  }

  return at - prevAt > SEPARATOR_GAP_MS ? timeOf(at) : null;
}
