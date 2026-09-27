import { describe, it, expect, vi } from 'vitest';
import { ErrandRepository, ErrandRepositoryFactory } from '../../../src/repositories/errand';
import { Errand } from '../../../src/entities/errand';

function makeDb() {
  return {
    run: vi.fn(),
    get: vi.fn(),
    query: vi.fn().mockReturnValue([]),
  };
}

describe('ErrandRepository', () => {
  it('save inserts every column, nulling absent optional fields', () => {
    const db = makeDb();
    const repository = new ErrandRepository(db as never);
    const errand = new Errand({ id: 'e1', goal: 'buy milk', originSessionId: 's1' });

    repository.save(errand);

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('INSERT INTO errands');
    expect(params).toEqual(['e1', 'buy milk', 'draft', 's1', null, null, null, errand.createdAt, null, null, null, null]);
  });

  it('saves and reads back the held closing reply', () => {
    const db = makeDb();
    const repository = new ErrandRepository(db as never);
    repository.save(new Errand({ id: 'e1', goal: 'buy milk', state: 'awaiting_confirmation', originSessionId: 's1', closingReply: 'Obrigado!' }));
    expect(db.run.mock.calls[0][0]).toContain('closing_reply');
    expect(db.run.mock.calls[0][1].at(-1)).toBe('Obrigado!');

    db.get.mockReturnValue({ id: 'e1', goal: 'g', state: 'awaiting_confirmation', origin_session_id: 's1', created_at: 'x', closing_reply: 'Obrigado!' });
    expect(repository.findById('e1')).toMatchObject({ state: 'awaiting_confirmation', closingReply: 'Obrigado!' });
  });

  it('update maps camelCase keys to snake_case', () => {
    const db = makeDb();
    const repository = new ErrandRepository(db as never);

    repository.update('e1', { state: 'awaiting_peer', notes: 'called them' });

    const [sql, values] = db.run.mock.calls[0];
    expect(sql).toBe('UPDATE errands SET state = ?, notes = ? WHERE id = ?');
    expect(values).toEqual(['awaiting_peer', 'called them', 'e1']);
  });

  it('update coerces an explicit undefined value to null instead of binding undefined', () => {
    const db = makeDb();
    const repository = new ErrandRepository(db as never);

    repository.update('e1', { pendingMessage: undefined });

    const [, values] = db.run.mock.calls[0];
    expect(values).toEqual([null, 'e1']);
  });

  it('update does nothing when there are no updates', () => {
    const db = makeDb();
    const repository = new ErrandRepository(db as never);

    repository.update('e1', {});

    expect(db.run).not.toHaveBeenCalled();
  });

  it('findById maps a row into an Errand', () => {
    const db = makeDb();
    db.get.mockReturnValue({
      id: 'e1',
      goal: 'buy milk',
      state: 'open',
      origin_session_id: 's1',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const repository = new ErrandRepository(db as never);

    const errand = repository.findById('e1');

    expect(errand?.id).toBe('e1');
    expect(errand?.state).toBe('open');
    expect(errand?.originSessionId).toBe('s1');
  });

  it('findById returns null when no row is found', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new ErrandRepository(db as never);

    expect(repository.findById('missing')).toBeNull();
  });

  it('findActiveBySessionId joins errand_targets and filters to active states only', () => {
    const db = makeDb();
    db.get.mockReturnValue({ id: 'e1', goal: 'g', state: 'awaiting_peer', origin_session_id: 's1', created_at: 'x' });
    const repository = new ErrandRepository(db as never);

    const errand = repository.findActiveBySessionId('target-session');

    const [sql, params] = db.get.mock.calls[0];
    expect(sql).toContain('JOIN errand_targets');
    expect(sql).toContain("IN (?, ?, ?, ?, ?)");
    expect(params[0]).toBe('target-session');
    expect(params.slice(1)).toEqual(['draft', 'open', 'awaiting_peer', 'awaiting_principal', 'awaiting_confirmation']);
    expect(errand?.id).toBe('e1');
  });

  it('findActiveBySessionId returns null when nothing active is found', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new ErrandRepository(db as never);

    expect(repository.findActiveBySessionId('target-session')).toBeNull();
  });

  it('findNextQueuedBySessionId only looks at queued state, oldest first', () => {
    const db = makeDb();
    db.get.mockReturnValue({ id: 'e2', goal: 'g', state: 'queued', origin_session_id: 's1', created_at: 'x' });
    const repository = new ErrandRepository(db as never);

    const errand = repository.findNextQueuedBySessionId('target-session');

    const [sql, params] = db.get.mock.calls[0];
    expect(sql).toContain("e.state = 'queued'");
    expect(sql).toContain('ORDER BY e.created_at ASC');
    expect(params).toEqual(['target-session']);
    expect(errand?.id).toBe('e2');
  });

  it('findByOriginSessionId orders by created_at desc', () => {
    const db = makeDb();
    db.query.mockReturnValue([{ id: 'e1', goal: 'g', state: 'draft', origin_session_id: 's1', created_at: 'x' }]);
    const repository = new ErrandRepository(db as never);

    const errands = repository.findByOriginSessionId('s1');

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), ['s1']);
    expect(errands).toHaveLength(1);
  });

  it('findAll filters by state when provided', () => {
    const db = makeDb();
    const repository = new ErrandRepository(db as never);

    repository.findAll('resolved', 10, 5);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('WHERE state = ?');
    expect(params).toEqual(['resolved', 10, 5]);
  });

  it('findAll returns everything, ordered by last progress, when no state filter is given', () => {
    const db = makeDb();
    const repository = new ErrandRepository(db as never);

    repository.findAll();

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(sql).toContain('COALESCE(last_progress_at, created_at) DESC');
    expect(params).toEqual([50, 0]);
  });

  it('addTarget inserts with OR IGNORE so a duplicate target is a no-op', () => {
    const db = makeDb();
    const repository = new ErrandRepository(db as never);

    repository.addTarget('e1', 's1');

    expect(db.run).toHaveBeenCalledWith(
      'INSERT OR IGNORE INTO errand_targets (errand_id, session_id) VALUES (?, ?)',
      ['e1', 's1'],
    );
  });

  it('findTargets returns the list of session ids', () => {
    const db = makeDb();
    db.query.mockReturnValue([{ session_id: 's1' }, { session_id: 's2' }]);
    const repository = new ErrandRepository(db as never);

    expect(repository.findTargets('e1')).toEqual(['s1', 's2']);
  });

  it('countByState counts rows in that state', () => {
    const db = makeDb();
    db.get.mockReturnValue({ total: 4 });
    const repository = new ErrandRepository(db as never);

    expect(repository.countByState('awaiting_principal')).toBe(4);
    expect(db.get).toHaveBeenCalledWith('SELECT COUNT(*) as total FROM errands WHERE state = ?', ['awaiting_principal']);
  });

  it('countByState returns 0 when no row comes back', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new ErrandRepository(db as never);

    expect(repository.countByState('draft')).toBe(0);
  });

  it('factory create returns an ErrandRepository bound to the db', () => {
    const db = makeDb();
    const repository = ErrandRepositoryFactory.create(db as never);

    expect(repository).toBeInstanceOf(ErrandRepository);
  });
});
