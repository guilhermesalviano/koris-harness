import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseServiceFactory, type IDatabaseService } from '../../src/infrastructure/db-sqlite';
import { SessionManager } from '../../src/services/session-manager';
import { SessionRepositoryFactory } from '../../src/repositories/session';
import { MessageRepositoryFactory } from '../../src/repositories/message';
import { Message } from '../../src/entities/message';
import { Session } from '../../src/entities/session';
import { AdminRouterFactory } from '../../src/dashboard/admin';
import { activeRunsRegistry } from '../../src/dashboard/active-runs';

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

describe('Orchestrator timeline', () => {
  let db: IDatabaseService;

  afterEach(() => {
    db?.close();
    vi.restoreAllMocks();
  });

  function setup() {
    db = DatabaseServiceFactory.create({ filepath: ':memory:', verbose: false });
    const manager = new SessionManager(db);
    const sessions = SessionRepositoryFactory.create(db);
    const messages = MessageRepositoryFactory.create(db);
    const router = AdminRouterFactory.create(logger, db, {} as never, manager);

    const request = (path: string, method: 'get' | 'post', query: Record<string, string> = {}) => {
      const layer = router.stack.find((item) => item.route?.path === path && (item.route as any).methods[method]);
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      (layer!.route as any).stack[0].handle({ params: {}, query, body: {} }, res, vi.fn());
      return { status: res.status.mock.calls[0]?.[0] as number | undefined, body: res.json.mock.calls[0][0] };
    };

    const addSession = (props: Partial<ConstructorParameters<typeof Session>[0]> = {}) => {
      const session = new Session({ channel: 'web', peerId: 'web', ...props });
      sessions.save(session);
      return session;
    };

    // Timestamps are minutes past 10:00 on one day, so ordering is easy to read.
    const addMessage = (sessionId: string, minute: number, content: string) => {
      const createdAt = `2026-09-01T10:${String(minute).padStart(2, '0')}:00.000Z`;
      messages.save(new Message({ sessionId, role: 'user', content, createdAt }));
    };

    return { manager, sessions, messages, request, addSession, addMessage };
  }

  it('pages backwards across web sessions without gaps or duplicates, skipping other threads', () => {
    const { request, addSession, addMessage, sessions } = setup();
    const first = addSession({ startedAt: '2026-09-01T10:00:00.000Z', endedAt: '2026-09-01T10:03:30.000Z' });
    const second = addSession({ startedAt: '2026-09-01T10:04:00.000Z', metadata: { startReason: 'compact', compactSummary: 'we talked' } });
    const telegram = new Session({ channel: 'telegram', peerId: '42' });
    const errand = new Session({ channel: 'web', peerId: 'web', kind: 'delegated' });
    sessions.save(telegram);
    sessions.save(errand);

    for (let minute = 0; minute < 4; minute++) addMessage(first.id, minute, `first-${minute}`);
    for (let minute = 4; minute < 7; minute++) addMessage(second.id, minute, `second-${minute}`);
    addMessage(telegram.id, 5, 'telegram');
    addMessage(errand.id, 5, 'errand');

    const seen: string[] = [];
    let cursor: string | undefined;
    const pages = [];
    do {
      const { body } = request('/agents/orchestrator/timeline', 'get', { limit: '2', ...(cursor ? { before: cursor } : {}) });
      pages.push(body);
      seen.unshift(...body.messages.map((m: { content: string }) => m.content));
      cursor = body.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toEqual(['first-0', 'first-1', 'first-2', 'first-3', 'second-4', 'second-5', 'second-6']);
    expect(pages).toHaveLength(4);

    const newest = pages[0];
    expect(newest.activeSessionId).toBe(second.id);
    expect(newest.messages.every((m: { sessionId: string }) => m.sessionId === second.id)).toBe(true);
    expect(newest.sessions).toEqual([
      { id: second.id, startedAt: second.startedAt, endedAt: null, startReason: 'compact', compactSummary: 'we talked' },
    ]);

    // The second page (first-3, second-4) straddles the boundary, so it lists both sessions.
    expect(pages[1].sessions.map((s: { id: string }) => s.id).sort()).toEqual([first.id, second.id].sort());
    expect(pages[1].sessions.find((s: { id: string }) => s.id === first.id).startReason).toBeNull();
  });

  it('includes the open session on the newest page even before it has messages', () => {
    const { request, addSession, addMessage } = setup();
    const old = addSession({ endedAt: '2026-09-01T11:00:00.000Z' });
    addMessage(old.id, 1, 'hello');
    const fresh = addSession({ metadata: { startReason: 'clear' } });

    const { body } = request('/agents/orchestrator/timeline', 'get');

    expect(body.activeSessionId).toBe(fresh.id);
    expect(body.sessions.map((s: { id: string }) => s.id)).toContain(fresh.id);
    expect(body.nextCursor).toBeNull();
  });

  it('returns subagent sender attribution in history and in older timeline pages', () => {
    const { request, addSession, addMessage, messages } = setup();
    const parent = addSession();
    messages.save(new Message({ sessionId: parent.id, role: 'assistant', senderAgentId: 'negotiator', content: 'Booked.', createdAt: '2026-09-01T10:00:00.000Z' }));
    addMessage(parent.id, 1, 'Thank you');

    expect(messages.getBySessionId(parent.id)[0].senderAgentId).toBe('negotiator');
    const newest = request('/agents/orchestrator/timeline', 'get', { limit: '1' }).body;
    expect(newest.messages[0].senderAgentId).toBeUndefined();
    const older = request('/agents/orchestrator/timeline', 'get', { limit: '1', before: newest.nextCursor }).body;
    expect(older.messages[0]).toMatchObject({ senderAgentId: 'negotiator', content: 'Booked.', sessionId: parent.id });
  });

  it('rejects a malformed cursor', () => {
    const { request } = setup();

    expect(request('/agents/orchestrator/timeline', 'get', { before: 'not-a-cursor' }).status).toBe(400);
  });

  describe('POST /agents/orchestrator/new-session', () => {
    it('creates the first web session when none is open', () => {
      const { request, sessions } = setup();

      const { status, body } = request('/agents/orchestrator/new-session', 'post');

      expect(status).toBe(201);
      expect(body.rotated).toBe(false);
      expect(sessions.findLatestOpen({ channel: 'web', peerId: 'web', kind: 'user' })?.id).toBe(body.session.id);
    });

    it('reuses an open session that has no messages yet', () => {
      const { request, addSession } = setup();
      const empty = addSession();

      const { status, body } = request('/agents/orchestrator/new-session', 'post');

      expect(status).toBeUndefined();
      expect(body).toMatchObject({ rotated: false, session: { id: empty.id } });
    });

    it('ends a used session and starts a new one marked as cleared, keeping the reply mode', () => {
      const { request, addSession, addMessage, sessions } = setup();
      const used = addSession({ metadata: { responseMode: 'voice', compactSummary: 'old' } });
      addMessage(used.id, 1, 'hi');

      const { status, body } = request('/agents/orchestrator/new-session', 'post');

      expect(status).toBe(201);
      expect(body.rotated).toBe(true);
      expect(body.session.metadata).toEqual({ responseMode: 'voice', startReason: 'clear' });
      expect(sessions.findById(used.id)?.endedAt).toBeTruthy();
      expect(sessions.findLatestOpen({ channel: 'web', peerId: 'web', kind: 'user' })?.id).toBe(body.session.id);
    });

    it('refuses while a reply is still running in the open session', () => {
      const { request, addSession, addMessage } = setup();
      const busy = addSession();
      addMessage(busy.id, 1, 'working on it');
      vi.spyOn(activeRunsRegistry, 'list').mockReturnValue([
        { id: 'run-1', sessionId: busy.id, question: 'q', startedAt: '2026-09-01T10:01:00.000Z', channel: 'web' },
      ]);

      expect(request('/agents/orchestrator/new-session', 'post').status).toBe(409);
    });
  });
});
