import { describe, it, expect, vi } from 'vitest';
import { ChannelRepository, ChannelRepositoryFactory } from '../../../src/repositories/channel';

function makeDb(overrides: { row?: Record<string, unknown>; principalRow?: Record<string, unknown>; byIdRow?: Record<string, unknown>; rows?: unknown[] } = {}) {
  return {
    run: vi.fn(),
    transaction: vi.fn((fn: () => unknown) => fn()),
    query: vi.fn().mockReturnValue(overrides.rows ?? []),
    get: vi.fn((sql: string) => {
      if (sql.includes('is_principal = 1')) return overrides.principalRow;
      if (sql.includes('WHERE id = ?')) return overrides.byIdRow;
      if (sql.includes('WHERE channel = ? AND target = ?')) return overrides.row;
      return undefined;
    }),
  };
}

function makeRow(overrides: Partial<{ is_principal: number }> = {}) {
  return {
    id: 'c1',
    channel: 'telegram',
    target: '987654321',
    is_principal: overrides.is_principal ?? 0,
    created_at: '2025-12-01T00:00:00.000Z',
    updated_at: '2025-12-01T00:00:00.000Z',
  };
}

describe('ChannelRepository', () => {
  it('upsert inserts a new channel and marks it as principal when none exists', () => {
    const db = makeDb({ row: makeRow() });
    const repository = new ChannelRepository(db as never);

    const channel = repository.upsert('telegram', '987654321');

    expect(db.run).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT OR IGNORE INTO channels'),
      expect.arrayContaining(['telegram', '987654321']),
    );
    expect(db.run).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE channels SET is_principal = 1'),
      expect.any(Array),
    );
    expect(channel.isPrincipal).toBe(true);
    expect(channel.channel).toBe('telegram');
    expect(channel.target).toBe('987654321');
  });

  it('upsert keeps an existing principal when inserting a second channel', () => {
    const db = makeDb({ row: makeRow(), principalRow: makeRow() });
    const repository = new ChannelRepository(db as never);

    const channel = repository.upsert('telegram', '987654321');

    expect(db.run).toHaveBeenCalledTimes(1);
    expect(channel.isPrincipal).toBe(false);
  });

  it('upsert does not demote an existing principal row', () => {
    const db = makeDb({ row: makeRow({ is_principal: 1 }) });
    const repository = new ChannelRepository(db as never);

    const channel = repository.upsert('telegram', '987654321');

    expect(db.run).toHaveBeenCalledTimes(1);
    expect(channel.isPrincipal).toBe(true);
  });

  it('getPrincipal queries for the principal channel', () => {
    const db = makeDb({ principalRow: makeRow({ is_principal: 1 }) });
    const repository = new ChannelRepository(db as never);

    const principal = repository.getPrincipal();

    expect(db.get).toHaveBeenCalledWith(
      'SELECT * FROM channels WHERE is_principal = 1 ORDER BY created_at ASC LIMIT 1',
    );
    expect(principal?.channel).toBe('telegram');
  });

  it('getPrincipal returns null when no principal exists', () => {
    const db = makeDb();
    const repository = new ChannelRepository(db as never);

    expect(repository.getPrincipal()).toBeNull();
  });

  it('getByChannel queries with the exact channel', () => {
    const db = makeDb({ rows: [makeRow()] });
    const repository = new ChannelRepository(db as never);

    repository.getByChannel('telegram');

    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM channels WHERE channel = ? ORDER BY created_at ASC',
      ['telegram'],
    );
  });

  it('getByChannel maps rows into Channel entities', () => {
    const db = makeDb({ rows: [makeRow({ is_principal: 1 })] });
    const repository = new ChannelRepository(db as never);

    const items = repository.getByChannel('telegram');

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('c1');
    expect(items[0].target).toBe('987654321');
    expect(items[0].isPrincipal).toBe(true);
  });

  it('getAll returns all channels ordered by creation', () => {
    const db = makeDb({ rows: [makeRow(), makeRow({ is_principal: 1 })] });
    const repository = new ChannelRepository(db as never);

    const items = repository.getAll();

    expect(db.query).toHaveBeenCalledWith('SELECT * FROM channels ORDER BY created_at ASC');
    expect(items).toHaveLength(2);
  });

  it('setPrincipal demotes all other channels and marks the target as principal', () => {
    const db = makeDb({ byIdRow: makeRow() });
    const repository = new ChannelRepository(db as never);

    const updated = repository.setPrincipal('c1');

    expect(db.run).toHaveBeenNthCalledWith(
      1,
      'UPDATE channels SET is_principal = 0, updated_at = CURRENT_TIMESTAMP WHERE id != ?',
      ['c1'],
    );
    expect(db.run).toHaveBeenNthCalledWith(
      2,
      'UPDATE channels SET is_principal = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['c1'],
    );
    expect(updated?.id).toBe('c1');
    expect(updated?.isPrincipal).toBe(true);
  });

  it('setPrincipal returns null when the channel does not exist', () => {
    const db = makeDb({ row: undefined });
    const repository = new ChannelRepository(db as never);

    expect(repository.setPrincipal('missing')).toBeNull();
    expect(db.run).not.toHaveBeenCalled();
  });

  it('factory create returns a ChannelRepository', () => {
    const db = makeDb();
    expect(ChannelRepositoryFactory.create(db as never)).toBeInstanceOf(ChannelRepository);
  });
});
