export const ERRAND_STATES = [
  'draft',
  'queued',
  'open',
  'awaiting_peer',
  'awaiting_principal',
  'awaiting_confirmation',
  'resolved',
  'failed',
  'cancelled',
  'expired',
] as const;
export type ErrandState = typeof ERRAND_STATES[number];

export interface ErrandDelivery {
  id: string;
  type: 'opener' | 'resume';
  content: string;
  answer?: string;
  targets: { sessionId: string; sentAt?: string; error?: string }[];
  error?: string;
}

/** States a `hydrate()` read treats as "still in flight" — eligible to lazily
 * flip to `expired` against `errands.hard_expiry_ms`. */
export const ERRAND_OPEN_STATES: readonly ErrandState[] = ['open', 'awaiting_peer', 'awaiting_principal', 'awaiting_confirmation'];

export const ERRAND_CLOSED_STATES: readonly ErrandState[] = ['resolved', 'failed', 'cancelled', 'expired'];
