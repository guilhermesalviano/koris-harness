export const SESSION_KINDS = ['user', 'delegated'] as const;
export type SessionKind = typeof SESSION_KINDS[number];

/** Why a session was opened in place of the previous one on the same thread,
 * stored as `metadata.startReason`: idle TTL expiry, `/clear` (or the web
 * "New session" button), or `/compact` / auto-compaction. */
export const SESSION_START_REASONS = ['idle', 'clear', 'compact'] as const;
export type SessionStartReason = typeof SESSION_START_REASONS[number];

/** Stored on each errand's own child session, independently of its transcript. */
export interface ErrandSessionMetadata extends Record<string, unknown> {
  parentSessionId: string;
  errandId: string;
  instructions: string;
}

/** Channel of the principal-facing session each errand gets once its opener is
 * sent: the Negotiator's notices and the principal's answers live there, apart
 * from the Orchestrator conversation that started the errand. */
export const NEGOTIATION_CHANNEL = 'negotiator';

/** Stored on an errand's negotiation session. */
export interface NegotiationSessionMetadata extends Record<string, unknown> {
  errandId: string;
  parentSessionId: string;
}

/** Identifies a conversation thread: the channel it lives on, the peer it's
 * with, and whether it's the principal's own conversation or one koris is
 * running on their behalf. Replaces the old opaque `entryChannel` string,
 * which could not distinguish "the WhatsApp chat with contact X" from "the
 * web channel" or express "list every WhatsApp chat". */
export interface SessionKey {
  channel: string;
  peerId: string;
  kind?: SessionKind;
}
