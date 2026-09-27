import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionService } from '../../../src/services/session-service';
import { Session } from '../../../src/entities/session';
import { nowISO } from '../../../src/utils/date';

function makeRepo() {
  return {
    save: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(),
    findLatestOpen: vi.fn().mockReturnValue(null),
    rotate: vi.fn(),
  };
}

describe('SessionService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('persists the session on construction by default', () => {
    const repo = makeRepo();
    const session = new Session({ channel: 'tui', peerId: 'tui' });
    new SessionService(repo as any, session);
    expect(repo.save).toHaveBeenCalledWith(session);
  });

  it('does not persist when persistOnConstruct is false', () => {
    const repo = makeRepo();
    const session = new Session({ id: 'existing', channel: 'tui', peerId: 'tui' });
    new SessionService(repo as any, session, { persistOnConstruct: false });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('getSession returns the initial session', () => {
    const repo = makeRepo();
    const session = new Session({ channel: 'tui', peerId: 'tui' });
    const svc = new SessionService(repo as any, session);
    expect(svc.getSession()).toBe(session);
  });

  it('updateCount increments messageCount by 1', () => {
    const repo = makeRepo();
    const session = new Session({ channel: 'tui', peerId: 'tui', messageCount: 2 });
    const svc = new SessionService(repo as any, session);
    svc.updateCount();
    expect(svc.getSession().messageCount).toBe(3);
  });

  it('updateCount persists a sparse patch via repo.update — only messageCount and metadata', () => {
    const repo = makeRepo();
    const session = new Session({ channel: 'tui', peerId: 'tui' });
    const svc = new SessionService(repo as any, session);
    svc.updateCount();
    expect(repo.update).toHaveBeenCalledTimes(1);
    const [, patch] = repo.update.mock.calls[0];
    expect(Object.keys(patch).sort()).toEqual(['messageCount', 'metadata']);
    expect(patch.messageCount).toBe(1);
  });

  it('updateCount sets lastActivityAt in metadata', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
    const expected = nowISO();

    const repo = makeRepo();
    const session = new Session({ channel: 'tui', peerId: 'tui' });
    const svc = new SessionService(repo as any, session);
    svc.updateCount();

    expect(svc.getSession().metadata.lastActivityAt).toBe(expected);
  });

  it('updateMetadata persists a sparse patch — only metadata, never endedAt/channel/etc', () => {
    const repo = makeRepo();
    const session = new Session({ id: 's1', channel: 'tui', peerId: 'tui', metadata: { lastActivityAt: 'x' } });
    const svc = new SessionService(repo as any, session, { persistOnConstruct: false });

    svc.updateMetadata({ responseMode: 'voice' });

    expect(repo.update).toHaveBeenCalledTimes(1);
    const [id, patch] = repo.update.mock.calls[0];
    expect(id).toBe('s1');
    expect(Object.keys(patch)).toEqual(['metadata']);
    expect(patch.metadata).toEqual({ lastActivityAt: 'x', responseMode: 'voice' });
    expect(svc.getSession().metadata).toEqual({ lastActivityAt: 'x', responseMode: 'voice' });
  });

  it('updateCount passes original id to repo.update', () => {
    const repo = makeRepo();
    const session = new Session({ channel: 'tui', peerId: 'tui' });
    const svc = new SessionService(repo as any, session);
    svc.updateCount();
    expect(repo.update.mock.calls[0][0]).toBe(session.id);
  });

  it('multiple updateCount calls accumulate correctly', () => {
    const repo = makeRepo();
    const session = new Session({ channel: 'tui', peerId: 'tui' });
    const svc = new SessionService(repo as any, session);
    svc.updateCount();
    svc.updateCount();
    svc.updateCount();
    expect(svc.getSession().messageCount).toBe(3);
    expect(repo.update).toHaveBeenCalledTimes(3);
  });

  it('preserves session channel/peerId after updateCount', () => {
    const repo = makeRepo();
    const session = new Session({ channel: 'telegram', peerId: '5551234' });
    const svc = new SessionService(repo as any, session);
    svc.updateCount();
    expect(svc.getSession().channel).toBe('telegram');
    expect(svc.getSession().peerId).toBe('5551234');
  });

  describe('ensureActiveSession', () => {
    it('returns the same session when not expired', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));

      const repo = makeRepo();
      const session = new Session({
        channel: 'tui',
        peerId: 'tui',
        startedAt: '2024-06-01T11:50:00.000Z',
        metadata: { lastActivityAt: '2024-06-01T11:50:00.000Z' },
      });
      const svc = new SessionService(repo as any, session, { persistOnConstruct: false });

      const result = svc.ensureActiveSession();

      expect(result.id).toBe(session.id);
      expect(repo.rotate).not.toHaveBeenCalled();
    });

    it('ends expired session and creates a new one atomically via repo.rotate', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));
      const expected = nowISO();

      const repo = makeRepo();
      const session = new Session({
        id: 'old-session',
        channel: 'tui',
        peerId: 'tui',
        startedAt: '2024-06-01T08:00:00.000Z',
        metadata: { lastActivityAt: '2024-06-01T08:00:00.000Z' },
      });
      const svc = new SessionService(repo as any, session, { persistOnConstruct: false });

      const result = svc.ensureActiveSession();

      expect(repo.rotate).toHaveBeenCalledTimes(1);
      const [endingId, endedAt, newSession] = repo.rotate.mock.calls[0];
      expect(endingId).toBe('old-session');
      expect(endedAt).toBe(expected);
      expect(newSession.channel).toBe('tui');
      expect(newSession.peerId).toBe('tui');
      expect(newSession.metadata.startReason).toBe('idle');
      expect(result.id).not.toBe('old-session');
      expect(result.channel).toBe('tui');
    });

    it('returns the same session even when expired when rotateOnExpire is false', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));

      const repo = makeRepo();
      const session = new Session({
        id: 'old-session',
        channel: 'tui',
        peerId: 'tui',
        startedAt: '2024-06-01T10:00:00.000Z',
        metadata: { lastActivityAt: '2024-06-01T10:00:00.000Z' },
      });
      const svc = new SessionService(repo as any, session, {
        persistOnConstruct: false,
        rotateOnExpire: false,
      });

      const result = svc.ensureActiveSession();

      expect(result.id).toBe('old-session');
      expect(repo.rotate).not.toHaveBeenCalled();
    });

    it('never rotates a delegated session on idle TTL by default', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));

      const repo = makeRepo();
      const session = new Session({
        id: 'delegated-session',
        channel: 'whatsapp',
        peerId: '5551234',
        kind: 'delegated',
        startedAt: '2024-01-01T00:00:00.000Z',
        metadata: { lastActivityAt: '2024-01-01T00:00:00.000Z' },
      });
      const svc = new SessionService(repo as any, session, { persistOnConstruct: false });

      const result = svc.ensureActiveSession();

      expect(result.id).toBe('delegated-session');
      expect(repo.rotate).not.toHaveBeenCalled();
    });

    it('an explicit rotateOnExpire: true still rotates a delegated session', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));

      const repo = makeRepo();
      const session = new Session({
        id: 'delegated-session',
        channel: 'whatsapp',
        peerId: '5551234',
        kind: 'delegated',
        startedAt: '2024-01-01T00:00:00.000Z',
        metadata: { lastActivityAt: '2024-01-01T00:00:00.000Z' },
      });
      const svc = new SessionService(repo as any, session, {
        persistOnConstruct: false,
        rotateOnExpire: true,
      });

      svc.ensureActiveSession();

      expect(repo.rotate).toHaveBeenCalledTimes(1);
    });
  });

  describe('forceRotate', () => {
    it('ends the current session and starts a new one via repo.rotate', () => {
      const repo = makeRepo();
      const session = new Session({ id: 'old-session', channel: 'tui', peerId: 'tui' });
      const svc = new SessionService(repo as any, session, { persistOnConstruct: false });

      const result = svc.forceRotate('clear');

      expect(repo.rotate).toHaveBeenCalledTimes(1);
      const [endingId, endedAt, newSession] = repo.rotate.mock.calls[0];
      expect(endingId).toBe('old-session');
      expect(typeof endedAt).toBe('string');
      expect(newSession.channel).toBe('tui');
      expect(result.id).not.toBe('old-session');
      expect(result.channel).toBe('tui');
      expect(svc.getSession()).toBe(result);
    });

    it('rotates even when the session is not expired', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));

      const repo = makeRepo();
      const session = new Session({
        id: 'fresh-session',
        channel: 'tui',
        peerId: 'tui',
        metadata: { lastActivityAt: '2024-06-01T11:59:00.000Z' },
      });
      const svc = new SessionService(repo as any, session, { persistOnConstruct: false });

      const result = svc.forceRotate('clear');

      expect(result.id).not.toBe('fresh-session');
    });

    it('seeds the new session with the given metadata', () => {
      const repo = makeRepo();
      const session = new Session({ id: 'old-session', channel: 'tui', peerId: 'tui' });
      const svc = new SessionService(repo as any, session, { persistOnConstruct: false });

      const result = svc.forceRotate('compact', { compactSummary: 'we discussed the roadmap' });

      expect(result.metadata.compactSummary).toBe('we discussed the roadmap');
    });

    it('records why the new session was started', () => {
      const repo = makeRepo();
      const session = new Session({ id: 'old-session', channel: 'tui', peerId: 'tui' });
      const svc = new SessionService(repo as any, session, { persistOnConstruct: false });

      expect(svc.forceRotate('clear').metadata.startReason).toBe('clear');
      expect(svc.forceRotate('compact', { compactSummary: 's' }).metadata).toEqual({ compactSummary: 's', startReason: 'compact' });
    });
  });
});
