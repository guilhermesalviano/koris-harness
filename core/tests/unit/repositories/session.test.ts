import { describe, it, expect, vi } from 'vitest';
import { SessionRepository, SessionRepositoryFactory } from '../../../src/repositories/session';
import { Session } from '../../../src/entities/session';

function makeDb() {
  return {
    run: vi.fn(),
    get: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    transaction: vi.fn((fn: () => unknown) => fn()),
  };
}

describe('SessionRepository', () => {
  it('save inserts the session with JSON-encoded metadata', () => {
    const db = makeDb();
    const repository = new SessionRepository(db as never);
    const session = new Session({ id: 's1', channel: 'tui', peerId: 'tui', metadata: { foo: 1 } });

    repository.save(session);

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('INSERT INTO sessions');
    expect(params).toEqual(['s1', 'tui', 'tui', 'user', session.startedAt, undefined, 0, '{"foo":1}']);
  });

  it('save persists a delegated session kind', () => {
    const db = makeDb();
    const repository = new SessionRepository(db as never);
    const session = new Session({ id: 's1', channel: 'whatsapp', peerId: '5551234', kind: 'delegated' });

    repository.save(session);

    const [, params] = db.run.mock.calls[0];
    expect(params[3]).toBe('delegated');
  });

  it('update maps camelCase keys to snake_case and JSON-encodes objects', () => {
    const db = makeDb();
    const repository = new SessionRepository(db as never);

    repository.update('s1', { messageCount: 5, metadata: { k: 'v' }, channel: 'web' });

    const [sql, values] = db.run.mock.calls[0];
    expect(sql).toBe('UPDATE sessions SET message_count = ?, metadata = ?, channel = ? WHERE id = ?');
    expect(values).toEqual([5, '{"k":"v"}', 'web', 's1']);
  });

  // Regression: passing the whole session as a patch used to resurrect
  // `ended_at` to undefined and reopen a just-closed session. A sparse patch
  // must only ever contain the fields it intends to change.
  it('update never includes fields absent from the patch', () => {
    const db = makeDb();
    const repository = new SessionRepository(db as never);

    repository.update('s1', { messageCount: 5, metadata: { lastActivityAt: 'now' } });

    const [sql, values] = db.run.mock.calls[0];
    expect(sql).toBe('UPDATE sessions SET message_count = ?, metadata = ? WHERE id = ?');
    expect(values).toEqual([5, '{"lastActivityAt":"now"}', 's1']);
  });

  it('update does nothing when there are no updates', () => {
    const db = makeDb();
    const repository = new SessionRepository(db as never);

    repository.update('s1', {});

    expect(db.run).not.toHaveBeenCalled();
  });

  it('findById maps the row into a Session', () => {
    const db = makeDb();
    db.get.mockReturnValue({
      id: 's1',
      channel: 'tui',
      peer_id: 'tui',
      kind: 'user',
      started_at: '2026-01-01',
      metadata: '{"k":"v"}',
    });
    const repository = new SessionRepository(db as never);

    const session = repository.findById('s1');

    expect(session).not.toBeNull();
    expect(session?.id).toBe('s1');
    expect(session?.channel).toBe('tui');
    expect(session?.peerId).toBe('tui');
    expect(session?.kind).toBe('user');
    expect(session?.metadata).toEqual({ k: 'v' });
  });

  it('findById returns null when no row is found', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new SessionRepository(db as never);

    expect(repository.findById('nope')).toBeNull();
  });

  it('findById tolerates invalid JSON metadata', () => {
    const db = makeDb();
    db.get.mockReturnValue({ id: 's1', channel: 'tui', peer_id: 'tui', metadata: 'not-json' });
    const repository = new SessionRepository(db as never);

    const session = repository.findById('s1');

    expect(session?.metadata).toEqual({});
  });

  it('findById keeps metadata empty when the row has none', () => {
    const db = makeDb();
    db.get.mockReturnValue({ id: 's1', channel: 'tui', peer_id: 'tui' });
    const repository = new SessionRepository(db as never);

    const session = repository.findById('s1');

    expect(session?.metadata).toEqual({});
  });

  it('findById keeps metadata empty when the row metadata is null', () => {
    const db = makeDb();
    db.get.mockReturnValue({ id: 's1', channel: 'tui', peer_id: 'tui', metadata: null });
    const repository = new SessionRepository(db as never);

    const session = repository.findById('s1');

    expect(session?.metadata).toEqual({});
  });

  it('findLatestOpen queries by channel, peerId and kind, most recent first', () => {
    const db = makeDb();
    db.get.mockReturnValue({ id: 's1', channel: 'tui', peer_id: 'tui', kind: 'user' });
    const repository = new SessionRepository(db as never);

    repository.findLatestOpen({ channel: 'tui', peerId: 'tui' });

    const [sql, params] = db.get.mock.calls[0];
    expect(sql).toContain('channel = ?');
    expect(sql).toContain('peer_id = ?');
    expect(sql).toContain('kind = ?');
    expect(sql).toContain('ended_at IS NULL');
    expect(sql).toContain('ORDER BY started_at DESC');
    expect(sql).toContain('LIMIT 1');
    expect(params).toEqual(['tui', 'tui', 'user']);
  });

  it('findLatestOpen defaults kind to "user" when omitted', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new SessionRepository(db as never);

    repository.findLatestOpen({ channel: 'whatsapp', peerId: '5551234' });

    const [, params] = db.get.mock.calls[0];
    expect(params).toEqual(['whatsapp', '5551234', 'user']);
  });

  it('findLatestOpen respects an explicit delegated kind', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new SessionRepository(db as never);

    repository.findLatestOpen({ channel: 'whatsapp', peerId: '5551234', kind: 'delegated' });

    const [, params] = db.get.mock.calls[0];
    expect(params).toEqual(['whatsapp', '5551234', 'delegated']);
  });

  it('findLatestOpen returns null when no row is found', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new SessionRepository(db as never);

    expect(repository.findLatestOpen({ channel: 'tui', peerId: 'tui' })).toBeNull();
  });

  it('findLatestOpen returns the mapped session when a row is found', () => {
    const db = makeDb();
    db.get.mockReturnValue({ id: 's1', channel: 'tui', peer_id: 'tui', metadata: '{"k":"v"}' });
    const repository = new SessionRepository(db as never);

    const session = repository.findLatestOpen({ channel: 'tui', peerId: 'tui' });

    expect(session).not.toBeNull();
    expect(session?.id).toBe('s1');
    expect(session?.metadata).toEqual({ k: 'v' });
  });

  it('findAll queries with limit/offset and maps rows', () => {
    const db = makeDb();
    db.query.mockReturnValue([{ id: 's1', channel: 'tui', peer_id: 'tui' }]);
    const repository = new SessionRepository(db as never);

    const sessions = repository.findAll(10, 5);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY started_at DESC'), [10, 5]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('s1');
  });

  it('findAll filters by kind when provided', () => {
    const db = makeDb();
    const repository = new SessionRepository(db as never);

    repository.findAll(10, 0, 'delegated');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE kind = ?');
    expect(params).toEqual(['delegated', 10, 0]);
  });

  it('count returns the total row count', () => {
    const db = makeDb();
    db.get.mockReturnValue({ total: 7 });
    const repository = new SessionRepository(db as never);

    expect(repository.count()).toBe(7);
    expect(db.get).toHaveBeenCalledWith('SELECT COUNT(*) as total FROM sessions');
  });

  it('count filters by kind when provided', () => {
    const db = makeDb();
    db.get.mockReturnValue({ total: 3 });
    const repository = new SessionRepository(db as never);

    expect(repository.count('user')).toBe(3);
    expect(db.get).toHaveBeenCalledWith('SELECT COUNT(*) as total FROM sessions WHERE kind = ?', ['user']);
  });

  it('count returns 0 when no row comes back', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new SessionRepository(db as never);

    expect(repository.count()).toBe(0);
  });

  it('countOpen counts sessions with no ended_at', () => {
    const db = makeDb();
    db.get.mockReturnValue({ total: 2 });
    const repository = new SessionRepository(db as never);

    expect(repository.countOpen()).toBe(2);
    expect(db.get).toHaveBeenCalledWith('SELECT COUNT(*) as total FROM sessions WHERE ended_at IS NULL');
  });

  it('deleteById deletes a single session', () => {
    const db = makeDb();
    const repository = new SessionRepository(db as never);

    repository.deleteById('s1');

    expect(db.run).toHaveBeenCalledWith('DELETE FROM sessions WHERE id = ?', ['s1']);
  });

  it('rotate ends the old session and inserts the new one inside a transaction', () => {
    const db = makeDb();
    const repository = new SessionRepository(db as never);
    const newSession = new Session({ id: 's2', channel: 'tui', peerId: 'tui' });

    repository.rotate('s1', '2026-01-01T00:00:00.000Z', newSession);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.run).toHaveBeenCalledWith('UPDATE sessions SET ended_at = ? WHERE id = ?', ['2026-01-01T00:00:00.000Z', 's1']);
    const insertCall = db.run.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO sessions'));
    expect(insertCall?.[1][0]).toBe('s2');
  });

  it('factory create returns a SessionRepository bound to the db', () => {
    const db = makeDb();
    const repository = SessionRepositoryFactory.create(db as never);

    expect(repository).toBeInstanceOf(SessionRepository);
    repository.findById('s1');
    expect(db.get).toHaveBeenCalledWith('SELECT * FROM sessions WHERE id = ?', ['s1']);
  });

  it('count returns the total count of sessions or 0', () => {
    const db = { ...makeDb(), query: vi.fn() };
    db.get.mockReturnValueOnce({ total: 42 });
    const repository = new SessionRepository(db as never);
    expect(repository.count()).toBe(42);

    db.get.mockReturnValueOnce(undefined);
    expect(repository.count()).toBe(0);
  });

  it('countOpen returns the total count of open sessions or 0', () => {
    const db = { ...makeDb(), query: vi.fn() };
    db.get.mockReturnValueOnce({ total: 5 });
    const repository = new SessionRepository(db as never);
    expect(repository.countOpen()).toBe(5);

    db.get.mockReturnValueOnce(undefined);
    expect(repository.countOpen()).toBe(0);
  });

  it('findAll queries sessions with limit and offset', () => {
    const db = { ...makeDb(), query: vi.fn().mockReturnValue([{ id: 's1', entry_channel: 'web' }]) };
    const repository = new SessionRepository(db as never);
    const results = repository.findAll(10, 20);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('s1');
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?',
      [10, 20],
    );

    repository.findAll();
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?',
      [50, 0],
    );
  });
});
