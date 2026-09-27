export function isSessionExpired(
  lastActivityAt: string | undefined,
  ttlMs: number,
  now: number = Date.now(),
): boolean {
  if (!lastActivityAt) {
    return true;
  }

  return now - new Date(lastActivityAt).getTime() > ttlMs;
}

export function getLastActivityAt(session: {
  startedAt?: string;
  metadata?: Record<string, unknown>;
}): string | undefined {
  const fromMetadata = session.metadata?.lastActivityAt;
  if (typeof fromMetadata === 'string') {
    return fromMetadata;
  }

  return session.startedAt;
}

/** Single source of truth for "has this session gone idle past the TTL?" —
 * previously duplicated at every call site. */
export function isExpired(
  session: { startedAt?: string; metadata?: Record<string, unknown> },
  ttlMs: number,
  now: number = Date.now(),
): boolean {
  return isSessionExpired(getLastActivityAt(session), ttlMs, now);
}

// Session metadata keys that are a conversation preference rather than a
// property of one thread, so they must survive `/clear` and `/compact`
// rotation. `lastActivityAt` / `compactSummary` / `startReason` deliberately do not.
export function carryForwardMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const responseMode = metadata?.responseMode;
  return typeof responseMode === 'string' && responseMode ? { responseMode } : undefined;
}
