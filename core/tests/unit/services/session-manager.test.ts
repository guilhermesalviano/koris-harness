import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../../src/services/session-manager';
import { Session } from '../../../src/entities/session';
import { SessionRepositoryFactory } from '../../../src/repositories/session';
import { applyTestConfigDefaults } from '../../helpers/test-config';

vi.mock('../../../src/repositories/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/repositories/session')>();
  return {
    ...original,
    SessionRepositoryFactory: {
      create: vi.fn(),
    },
  };
});

function makeRepo() {
  return {
    save: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(),
    findLatestOpen: vi.fn().mockReturnValue(null),
    rotate: vi.fn(),
  };
}

describe('SessionManager', () => {
  beforeEach(() => {
    applyTestConfigDefaults();
    vi.useRealTimers();
  });

  describe('getSessionService (composite key)', () => {
    it('reopens a delegated conversation from storage after idle TTL without losing its transcript', () => {
      const repo = makeRepo();
      const existing = new Session({
        id: 'negotiation', channel: 'whatsapp', peerId: '555', kind: 'delegated',
        startedAt: '2000-01-01T00:00:00.000Z', metadata: { lastActivityAt: '2000-01-01T00:00:00.000Z' },
      });
      repo.findLatestOpen.mockReturnValue(existing);
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as never);
      const service = new SessionManager({} as never).getSessionService({ channel: 'whatsapp', peerId: '555', kind: 'delegated' });
      expect(service.ensureActiveSession().id).toBe('negotiation');
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.rotate).not.toHaveBeenCalled();
    });
    it('creates a new session when none is open, keyed by channel+peerId+kind', () => {
      const repo = makeRepo();
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);
      const service = manager.getSessionService({ channel: 'whatsapp', peerId: '5551234' });

      expect(repo.findLatestOpen).toHaveBeenCalledWith({ channel: 'whatsapp', peerId: '5551234' });
      expect(service.getSession().channel).toBe('whatsapp');
      expect(service.getSession().peerId).toBe('5551234');
      expect(service.getSession().kind).toBe('user');
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('resumes a non-expired open session without saving it again', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));

      const existing = new Session({
        id: 'resumed',
        channel: 'web',
        peerId: 'web',
        startedAt: '2024-06-01T11:50:00.000Z',
        metadata: { lastActivityAt: '2024-06-01T11:50:00.000Z' },
      });
      const repo = makeRepo();
      repo.findLatestOpen.mockReturnValue(existing);
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);
      const service = manager.getSessionService({ channel: 'web', peerId: 'web' });

      expect(service.getSession().id).toBe('resumed');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('creates a new session when the open session is expired', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));

      const expired = new Session({
        id: 'expired',
        channel: 'tui',
        peerId: 'tui',
        startedAt: '2024-06-01T08:00:00.000Z',
        metadata: { lastActivityAt: '2024-06-01T08:00:00.000Z' },
      });
      const repo = makeRepo();
      repo.findLatestOpen.mockReturnValue(expired);
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);
      const service = manager.getSessionService({ channel: 'tui', peerId: 'tui' });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(service.getSession().id).not.toBe('expired');
      expect(service.getSession().metadata.startReason).toBe('idle');
    });

    it('caches by the composite key: same channel+peerId+kind returns the same service', () => {
      const repo = makeRepo();
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);
      const first = manager.getSessionService({ channel: 'whatsapp', peerId: '555' });
      const second = manager.getSessionService({ channel: 'whatsapp', peerId: '555' });

      expect(second).toBe(first);
      expect(repo.findLatestOpen).toHaveBeenCalledTimes(1);
    });

    it('treats a "user" and "delegated" session with the same channel/peerId as distinct', () => {
      const repo = makeRepo();
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);
      const userSvc = manager.getSessionService({ channel: 'whatsapp', peerId: '555', kind: 'user' });
      const delegatedSvc = manager.getSessionService({ channel: 'whatsapp', peerId: '555', kind: 'delegated' });

      expect(userSvc).not.toBe(delegatedSvc);
      expect(userSvc.getSession().kind).toBe('user');
      expect(delegatedSvc.getSession().kind).toBe('delegated');
      expect(repo.findLatestOpen).toHaveBeenCalledTimes(2);
    });

    it('a different peerId on the same channel is cached separately', () => {
      const repo = makeRepo();
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);
      const a = manager.getSessionService({ channel: 'whatsapp', peerId: 'alice' });
      const b = manager.getSessionService({ channel: 'whatsapp', peerId: 'bob' });

      expect(a).not.toBe(b);
    });

    it('a delegated session defaults rotateOnExpire to false (never rotates on idle TTL)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));

      const freshDelegated = new Session({
        id: 'fresh-delegated',
        channel: 'whatsapp',
        peerId: '555',
        kind: 'delegated',
        startedAt: '2024-06-01T11:59:00.000Z',
        metadata: { lastActivityAt: '2024-06-01T11:59:00.000Z' },
      });
      const repo = makeRepo();
      repo.findLatestOpen.mockReturnValue(freshDelegated);
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);
      // Resolved while still fresh, so the manager reuses `freshDelegated` —
      // rather than transparently creating yet another new session — and
      // caches this SessionService instance bound to it.
      const service = manager.getSessionService({ channel: 'whatsapp', peerId: '555', kind: 'delegated' });
      expect(service.getSession().id).toBe('fresh-delegated');

      // Time now passes well beyond the TTL on the *same cached instance*.
      vi.setSystemTime(new Date('2024-06-02T12:00:00.000Z'));
      const result = service.ensureActiveSession();

      expect(result.id).toBe('fresh-delegated');
      expect(repo.rotate).not.toHaveBeenCalled();
    });

    it('a user session still rotates on idle TTL (rotateOnExpire default true)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));

      const freshUser = new Session({
        id: 'fresh-user',
        channel: 'whatsapp',
        peerId: '555',
        kind: 'user',
        startedAt: '2024-06-01T11:59:00.000Z',
        metadata: { lastActivityAt: '2024-06-01T11:59:00.000Z' },
      });
      const repo = makeRepo();
      repo.findLatestOpen.mockReturnValue(freshUser);
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);
      const service = manager.getSessionService({ channel: 'whatsapp', peerId: '555', kind: 'user' });
      expect(service.getSession().id).toBe('fresh-user');

      vi.setSystemTime(new Date('2024-06-02T12:00:00.000Z'));
      const result = service.ensureActiveSession();

      expect(result.id).not.toBe('fresh-user');
      expect(repo.rotate).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSessionServiceById', () => {
    it('binds getSessionServiceById to the exact session', () => {
      const repo = makeRepo();
      const session = new Session({ id: 'exact-session', channel: 'web', peerId: 'web' });
      repo.findById.mockReturnValue(session);
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);

      const service = manager.getSessionServiceById('exact-session');

      expect(repo.findById).toHaveBeenCalledWith('exact-session');
      expect(service.getSession().id).toBe('exact-session');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('caches session services by session id', () => {
      const repo = makeRepo();
      const session = new Session({ id: 'cached-session', channel: 'web', peerId: 'web' });
      repo.findById.mockReturnValue(session);
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);

      const first = manager.getSessionServiceById('cached-session');
      const second = manager.getSessionServiceById('cached-session');

      expect(second).toBe(first);
      expect(repo.findById).toHaveBeenCalledTimes(1);
    });

    it('does not rotate an expired by-id session', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'));

      const repo = makeRepo();
      const session = new Session({
        id: 'stale-session',
        channel: 'web',
        peerId: 'web',
        startedAt: '2024-06-01T10:00:00.000Z',
        metadata: { lastActivityAt: '2024-06-01T10:00:00.000Z' },
      });
      repo.findById.mockReturnValue(session);
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);

      const service = manager.getSessionServiceById('stale-session');
      const result = service.ensureActiveSession();

      expect(result.id).toBe('stale-session');
      expect(repo.rotate).not.toHaveBeenCalled();
    });

    it('throws when the session does not exist', () => {
      const repo = makeRepo();
      repo.findById.mockReturnValue(null);
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);

      expect(() => manager.getSessionServiceById('missing')).toThrow('Session not found: missing');
    });
  });

  describe('invalidate / invalidateKey', () => {
    it('invalidate drops the by-id cache entry', () => {
      const repo = makeRepo();
      const session = new Session({ id: 's1', channel: 'web', peerId: 'web' });
      repo.findById.mockReturnValue(session);
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);
      manager.getSessionServiceById('s1');
      manager.invalidate('s1');
      manager.getSessionServiceById('s1');

      expect(repo.findById).toHaveBeenCalledTimes(2);
    });

    it('invalidate also drops the composite-key cache entry for that session', () => {
      const repo = makeRepo();
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);
      const service = manager.getSessionService({ channel: 'web', peerId: 'web' });
      const sessionId = service.getSession().id;

      manager.invalidate(sessionId);
      manager.getSessionService({ channel: 'web', peerId: 'web' });

      expect(repo.findLatestOpen).toHaveBeenCalledTimes(2);
    });

    it('invalidateKey drops the composite-key cache entry directly', () => {
      const repo = makeRepo();
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);
      manager.getSessionService({ channel: 'web', peerId: 'web' });
      manager.invalidateKey({ channel: 'web', peerId: 'web' });
      manager.getSessionService({ channel: 'web', peerId: 'web' });

      expect(repo.findLatestOpen).toHaveBeenCalledTimes(2);
    });
  });

  describe('byIdCache LRU cap', () => {
    it('evicts the oldest entry once the cap is exceeded', () => {
      const repo = makeRepo();
      repo.findById.mockImplementation((id: string) => new Session({ id, channel: 'web', peerId: 'web' }));
      vi.mocked(SessionRepositoryFactory.create).mockReturnValue(repo as any);

      const manager = new SessionManager({} as any);
      for (let i = 0; i < 501; i++) {
        manager.getSessionServiceById(`session-${i}`);
      }
      repo.findById.mockClear();

      // The very first entry should have been evicted...
      manager.getSessionServiceById('session-0');
      expect(repo.findById).toHaveBeenCalledWith('session-0');

      repo.findById.mockClear();
      // ...but a recent one should still be cached.
      manager.getSessionServiceById('session-500');
      expect(repo.findById).not.toHaveBeenCalled();
    });
  });
});
