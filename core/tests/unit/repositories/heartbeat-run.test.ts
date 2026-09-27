import { describe, it, expect, vi } from 'vitest';
import { HeartbeatRunRepository, HeartbeatRunRepositoryFactory } from '../../../src/repositories/heartbeat-run';
import { formatISO } from '../../../src/utils/date';

function makeDb(rows: any[] = []) {
  return { run: vi.fn(), query: vi.fn(), get: vi.fn().mockReturnValue(rows[0]) };
}

describe('HeartbeatRunRepository', () => {
  it('recordRun inserts a new run with formatted dates', () => {
    const db = makeDb();
    const repository = new HeartbeatRunRepository(db as never);
    const runAt = new Date('2026-01-01T00:00:00Z');

    repository.recordRun({ runAt, status: 'success' });

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('INSERT INTO heartbeat_runs');
    expect(params[0]).toEqual(expect.any(String));
    expect(params[1]).toBe(formatISO(runAt));
    expect(params[2]).toBe('success');
    expect(params[3]).toBeNull();
  });

  it('recordRun stores the error message for failed runs', () => {
    const db = makeDb();
    const repository = new HeartbeatRunRepository(db as never);

    repository.recordRun({ runAt: new Date(), status: 'error', errorMessage: 'boom' });

    const params = db.run.mock.calls[0][1];
    expect(params[2]).toBe('error');
    expect(params[3]).toBe('boom');
  });

  it('getLastRun returns null when there are no runs', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new HeartbeatRunRepository(db as never);

    expect(repository.getLastRun()).toBeNull();
  });

  it('getLastRun queries the latest run by run_at', () => {
    const db = makeDb();
    const repository = new HeartbeatRunRepository(db as never);

    repository.getLastRun();

    expect(db.get).toHaveBeenCalledWith('SELECT * FROM heartbeat_runs ORDER BY run_at DESC LIMIT 1');
  });

  it('getLastRun maps the row into a HeartbeatRun entity', () => {
    const db = makeDb([
      {
        id: 'r1',
        run_at: '2026-01-01T00:00:00.000Z',
        status: 'error',
        error_message: 'boom',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const repository = new HeartbeatRunRepository(db as never);

    const run = repository.getLastRun();

    expect(run).not.toBeNull();
    expect(run?.id).toBe('r1');
    expect(run?.runAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(run?.status).toBe('error');
    expect(run?.errorMessage).toBe('boom');
  });

  it('factory getInstance throws before create is called', () => {
    expect(() => HeartbeatRunRepositoryFactory.getInstance()).toThrow('not initialized');
  });

  it('factory create returns the same instance when called again', () => {
    const db1 = makeDb();
    const db2 = makeDb();
    const first = HeartbeatRunRepositoryFactory.create(db1 as never);

    const second = HeartbeatRunRepositoryFactory.create(db2 as never);

    expect(second).toBe(first);
    expect(HeartbeatRunRepositoryFactory.getInstance()).toBe(first);
  });
});
