import { describe, it, expect } from 'vitest';
import { isSessionExpired, getLastActivityAt } from '../../../src/utils/session';

describe('isSessionExpired', () => {
  const ttlMs = 30 * 60 * 1000;
  const now = new Date('2024-06-01T12:00:00.000Z').getTime();

  it('returns true when lastActivityAt is undefined', () => {
    expect(isSessionExpired(undefined, ttlMs, now)).toBe(true);
  });

  it('returns false when last activity is within TTL', () => {
    const lastActivity = new Date(now - 10 * 60 * 1000).toISOString();
    expect(isSessionExpired(lastActivity, ttlMs, now)).toBe(false);
  });

  it('returns true when last activity exceeds TTL', () => {
    const lastActivity = new Date(now - 31 * 60 * 1000).toISOString();
    expect(isSessionExpired(lastActivity, ttlMs, now)).toBe(true);
  });

  it('returns false at exactly TTL boundary', () => {
    const lastActivity = new Date(now - ttlMs).toISOString();
    expect(isSessionExpired(lastActivity, ttlMs, now)).toBe(false);
  });
});

describe('getLastActivityAt', () => {
  it('prefers metadata.lastActivityAt over startedAt', () => {
    const session = {
      startedAt: '2024-01-01T00:00:00.000Z',
      metadata: { lastActivityAt: '2024-06-01T10:00:00.000Z' },
    };
    expect(getLastActivityAt(session)).toBe('2024-06-01T10:00:00.000Z');
  });

  it('falls back to startedAt when metadata has no lastActivityAt', () => {
    const session = {
      startedAt: '2024-01-01T00:00:00.000Z',
      metadata: {},
    };
    expect(getLastActivityAt(session)).toBe('2024-01-01T00:00:00.000Z');
  });
});
