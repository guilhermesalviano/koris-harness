import { describe, it, expect, vi } from 'vitest';
import { HeartbeatRepository, HeartbeatRepositoryFactory } from '../../../src/repositories/heartbeat';
import { Heartbeat } from '../../../src/entities/heartbeat';
import { formatISO } from '../../../src/utils/date';

function makeDb(rows: any[] = []) {
  return { run: vi.fn(), query: vi.fn().mockReturnValue(rows), get: vi.fn() };
}

function makeHeartbeat() {
  return new Heartbeat({
    id: 'h1',
    beat: 'send report',
    type: 'scheduled_beat',
    cronExpression: '0 9 * * *',
    lastRun: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2025-12-01T00:00:00Z'),
  });
}

describe('HeartbeatRepository', () => {
  it('save inserts the heartbeat with formatted dates', () => {
    const db = makeDb();
    const repository = new HeartbeatRepository(db as never);
    const heartbeat = makeHeartbeat();

    repository.save(heartbeat);

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('INSERT INTO heartbeat');
    expect(params).toEqual([
      'h1',
      'send report',
      'scheduled_beat',
      '0 9 * * *',
      formatISO(heartbeat.lastRun as Date),
      null,
      null,
      0,
      0,
      formatISO(heartbeat.createdAt),
    ]);
  });

  it('save stores managed flag when set', () => {
    const db = makeDb();
    const repository = new HeartbeatRepository(db as never);
    const heartbeat = new Heartbeat({
      id: 'h1',
      beat: '__koris_clear_images__',
      type: 'scheduled_beat',
      cronExpression: '0 0 * * *',
      managed: true,
    });

    repository.save(heartbeat);

    expect(db.run.mock.calls[0][1][7]).toBe(1);
  });

  it('save stores the run_once flag when set', () => {
    const db = makeDb();
    const repository = new HeartbeatRepository(db as never);
    const heartbeat = new Heartbeat({
      id: 'h1',
      beat: 'call mom',
      type: 'reminder',
      cronExpression: '30 9 15 6 *',
      runOnce: true,
    });

    repository.save(heartbeat);

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('run_once');
    expect(params[8]).toBe(1);
  });

  it('save stores the beat channel and target', () => {
    const db = makeDb();
    const repository = new HeartbeatRepository(db as never);
    const heartbeat = new Heartbeat({
      id: 'h1',
      beat: 'send report',
      type: 'scheduled_beat',
      cronExpression: '0 9 * * *',
      channel: 'telegram',
      target: '987654321',
      createdAt: new Date('2025-12-01T00:00:00Z'),
    });

    repository.save(heartbeat);

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('INSERT INTO heartbeat');
    expect(params[5]).toBe('telegram');
    expect(params[6]).toBe('987654321');
  });

  it('save stores null last_run when not provided', () => {
    const db = makeDb();
    const repository = new HeartbeatRepository(db as never);
    const heartbeat = new Heartbeat({
      beat: 't',
      type: 'reminder',
      cronExpression: '0 8 * * *',
    });

    repository.save(heartbeat);

    expect(db.run.mock.calls[0][1][4]).toBeNull();
  });

  it('getById returns null when no row is found', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new HeartbeatRepository(db as never);

    expect(repository.getById('nope')).toBeNull();
    expect(db.get).toHaveBeenCalledWith('SELECT * FROM heartbeat WHERE id = ?', ['nope']);
  });

  it('getById queries with the exact SQL and id', () => {
    const db = makeDb();
    db.get.mockReturnValue({
      id: 'h1',
      beat: 't',
      type: 'scheduled_beat',
      cron_expression: '0 9 * * *',
      created_at: '2025-12-01T00:00:00.000Z',
    });
    const repository = new HeartbeatRepository(db as never);

    repository.getById('h1');

    expect(db.get).toHaveBeenCalledWith('SELECT * FROM heartbeat WHERE id = ?', ['h1']);
  });

  it('getAll queries with the exact SQL', () => {
    const db = makeDb([]);
    const repository = new HeartbeatRepository(db as never);

    repository.getAll();

    expect(db.query).toHaveBeenCalledWith('SELECT * FROM heartbeat ORDER BY created_at DESC');
  });

  it('getAll maps rows into Heartbeat entities', () => {
    const db = makeDb([
      {
        id: 'h1',
        beat: 't',
        type: 'scheduled_beat',
        cron_expression: '0 9 * * *',
        last_run: '2026-01-01T00:00:00.000Z',
        created_at: '2025-12-01T00:00:00.000Z',
      },
    ]);
    const repository = new HeartbeatRepository(db as never);

    const items = repository.getAll();

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('h1');
    expect(items[0].cronExpression).toBe('0 9 * * *');
    expect(items[0].lastRun).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('update builds the SET clause from provided fields', () => {
    const db = makeDb();
    db.get.mockReturnValue({
      id: 'h1',
      beat: 'new',
      type: 'reminder',
      cron_expression: '0 8 * * *',
    });
    const repository = new HeartbeatRepository(db as never);

    repository.update('h1', { beat: 'new', cronExpression: '0 8 * * *' });

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toBe('UPDATE heartbeat SET beat = ?, cron_expression = ? WHERE id = ?');
    expect(params).toEqual(['new', '0 8 * * *', 'h1']);
  });

  it('update with no fields returns the current row without writing', () => {
    const db = makeDb();
    db.get.mockReturnValue({
      id: 'h1',
      beat: 't',
      type: 'reminder',
      cron_expression: '0 9 * * *',
    });
    const repository = new HeartbeatRepository(db as never);

    const result = repository.update('h1', {});

    expect(db.run).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
  });

  it('updateLastRun updates last_run with a formatted date', () => {
    const db = makeDb();
    const repository = new HeartbeatRepository(db as never);
    const lastRun = new Date('2026-02-01T00:00:00Z');

    repository.updateLastRun('h1', lastRun);

    expect(db.run).toHaveBeenCalledWith(
      'UPDATE heartbeat SET last_run = ? WHERE id = ?',
      [formatISO(lastRun), 'h1'],
    );
  });

  it('deleteById returns whether any row changed', () => {
    const db = makeDb();
    db.run.mockReturnValueOnce({ changes: 1 });
    const repository = new HeartbeatRepository(db as never);

    expect(repository.deleteById('h1')).toBe(true);
    expect(db.run).toHaveBeenCalledWith('DELETE FROM heartbeat WHERE id = ?', ['h1']);

    db.run.mockReturnValueOnce({ changes: 0 });
    expect(repository.deleteById('h2')).toBe(false);
  });

  it('deleteAll returns the number of deleted rows', () => {
    const db = makeDb();
    db.run.mockReturnValue({ changes: 3 });
    const repository = new HeartbeatRepository(db as never);

    expect(repository.deleteAll()).toBe(3);
    expect(db.run).toHaveBeenCalledWith('DELETE FROM heartbeat');
  });

  it('update maps the type field', () => {
    const db = makeDb();
    db.get.mockReturnValue({
      id: 'h1',
      beat: 't',
      type: 'scheduled_beat',
      cron_expression: '0 9 * * *',
    });
    const repository = new HeartbeatRepository(db as never);

    repository.update('h1', { type: 'reminder' });

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toBe('UPDATE heartbeat SET type = ? WHERE id = ?');
    expect(params).toEqual(['reminder', 'h1']);
  });

  it('update maps channel and target fields', () => {
    const db = makeDb();
    db.get.mockReturnValue({
      id: 'h1',
      beat: 't',
      type: 'reminder',
      cron_expression: '0 9 * * *',
    });
    const repository = new HeartbeatRepository(db as never);

    repository.update('h1', { channel: 'whatsapp', target: '5511@s.whatsapp.net' });

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toBe('UPDATE heartbeat SET channel = ?, target = ? WHERE id = ?');
    expect(params).toEqual(['whatsapp', '5511@s.whatsapp.net', 'h1']);
  });

  it('update maps the managed flag', () => {
    const db = makeDb();
    db.get.mockReturnValue({
      id: 'h1',
      beat: 't',
      type: 'reminder',
      cron_expression: '0 9 * * *',
    });
    const repository = new HeartbeatRepository(db as never);

    repository.update('h1', { managed: true });

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toBe('UPDATE heartbeat SET managed = ? WHERE id = ?');
    expect(params).toEqual([1, 'h1']);
  });

  it('update maps the run_once flag', () => {
    const db = makeDb();
    const repository = new HeartbeatRepository(db as never);

    repository.update('h1', { runOnce: false });

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toBe('UPDATE heartbeat SET run_once = ? WHERE id = ?');
    expect(params).toEqual([0, 'h1']);
  });

  it('getAll maps rows including channel and target into Heartbeat entities', () => {
    const db = makeDb([
      {
        id: 'h1',
        beat: 't',
        type: 'scheduled_beat',
        cron_expression: '0 9 * * *',
        channel: 'telegram',
        target: '987654321',
        last_run: '2026-01-01T00:00:00.000Z',
        created_at: '2025-12-01T00:00:00.000Z',
      },
    ]);
    const repository = new HeartbeatRepository(db as never);

    const items = repository.getAll();

    expect(items[0].channel).toBe('telegram');
    expect(items[0].target).toBe('987654321');
  });

  it('getAll maps the managed flag', () => {
    const db = makeDb([
      {
        id: 'h1',
        beat: '__koris_clear_images__',
        type: 'scheduled_beat',
        cron_expression: '0 0 * * *',
        managed: 1,
        created_at: '2025-12-01T00:00:00.000Z',
      },
    ]);
    const repository = new HeartbeatRepository(db as never);

    const [item] = repository.getAll();

    expect(item.managed).toBe(true);
  });

  it('getAll maps the run_once flag', () => {
    const db = makeDb([
      { id: 'h1', beat: 'a', type: 'reminder', cron_expression: '30 9 15 6 *', run_once: 1, created_at: '2025-12-01T00:00:00.000Z' },
      { id: 'h2', beat: 'b', type: 'reminder', cron_expression: '0 9 * * *', run_once: 0, created_at: '2025-12-01T00:00:00.000Z' },
    ]);
    const repository = new HeartbeatRepository(db as never);

    const [once, recurring] = repository.getAll();

    expect(once.runOnce).toBe(true);
    expect(recurring.runOnce).toBe(false);
  });

  it('factory getInstance throws before create is called', () => {
    expect(() => HeartbeatRepositoryFactory.getInstance()).toThrow('not initialized');
  });

  it('factory getInstance returns the created instance', () => {
    const db = makeDb();
    const instance = HeartbeatRepositoryFactory.create(db as never);

    expect(HeartbeatRepositoryFactory.getInstance()).toBe(instance);
  });

  it('factory create returns the same instance when called again', () => {
    const db1 = makeDb();
    const db2 = makeDb();
    const first = HeartbeatRepositoryFactory.create(db1 as never);

    const second = HeartbeatRepositoryFactory.create(db2 as never);

    expect(second).toBe(first);
  });
});
