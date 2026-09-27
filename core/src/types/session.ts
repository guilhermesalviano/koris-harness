export const SESSION_KINDS = ['user'] as const;
export type SessionKind = typeof SESSION_KINDS[number];

/** Why a session was opened in place of the previous one on the same thread,
 * stored as `metadata.startReason`: idle TTL expiry, `/clear` (or the web
 * "New session" button), or `/compact` / auto-compaction. */
export const SESSION_START_REASONS = ['idle', 'clear', 'compact'] as const;
export type SessionStartReason = typeof SESSION_START_REASONS[number];

/** Identifies a conversation thread: the channel it lives on and the peer it's
 * with. Replaces the old opaque `entryChannel` string, which could not
 * distinguish "the WhatsApp chat with contact X" from "the web channel" or
 * express "list every WhatsApp chat". */
export interface SessionKey {
  channel: string;
  peerId: string;
  kind?: SessionKind;
}
