import { describe, it, expect, vi } from 'vitest';
import { StickerRulesRepository, StickerRulesRepositoryFactory } from '../../../src/repositories/sticker-rules';
import type { StickerReference } from '../../../plugins/channels/contracts';

function makeDb() {
  return { run: vi.fn(), get: vi.fn(), query: vi.fn() };
}

function makeReference(): StickerReference {
  return {
    key: { remoteJid: 'jid@s.whatsapp.net', id: 'STANZA_1', participant: 'jid@s.whatsapp.net', fromMe: false },
    message: { stickerMessage: { mimetype: 'image/webp', mediaKey: 'abc' } },
    mimeType: 'image/webp',
  };
}

function makeRow(overrides: Partial<{
  id: string;
  description: string;
  reference: string;
  channel: string;
  enabled: number;
  learned_at: string;
}> = {}) {
  return {
    id: 'sticker_1',
    description: 'when the user is happy',
    reference: JSON.stringify(makeReference()),
    channel: 'whatsapp',
    enabled: 1,
    learned_at: '2026-01-01 00:00:00',
    ...overrides,
  };
}

describe('StickerRulesRepository', () => {
  it('save inserts a new rule and returns the mapped row', () => {
    const db = makeDb();
    const row = makeRow();
    db.get.mockReturnValue(row);
    const repository = new StickerRulesRepository(db as never);

    const result = repository.save({
      description: 'when the user is happy',
      reference: makeReference(),
      channel: 'whatsapp',
    });

    expect(db.run).toHaveBeenCalledTimes(1);
    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('INSERT INTO sticker_rules');
    expect(params[1]).toBe('when the user is happy');
    expect(params[2]).toBe(JSON.stringify(makeReference()));
    expect(params[3]).toBe('whatsapp');
    expect(result).toEqual({
      id: 'sticker_1',
      description: 'when the user is happy',
      reference: makeReference(),
      channel: 'whatsapp',
      enabled: true,
      learned_at: '2026-01-01 00:00:00',
    });
  });

  it('save throws when the inserted rule cannot be retrieved', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new StickerRulesRepository(db as never);

    expect(() =>
      repository.save({ description: 'x', reference: makeReference(), channel: 'whatsapp' }),
    ).toThrow('Failed to retrieve saved sticker rule');
  });

  it('getById returns the mapped rule or null', () => {
    const db = makeDb();
    const row = makeRow({ id: 's1', enabled: 0 });
    db.get.mockReturnValueOnce(row);
    const repository = new StickerRulesRepository(db as never);

    expect(repository.getById('s1')).toEqual({
      id: 's1',
      description: 'when the user is happy',
      reference: makeReference(),
      channel: 'whatsapp',
      enabled: false,
      learned_at: '2026-01-01 00:00:00',
    });
    expect(db.get).toHaveBeenCalledWith('SELECT * FROM sticker_rules WHERE id = ?', ['s1']);

    db.get.mockReturnValueOnce(undefined);
    expect(repository.getById('missing')).toBeNull();
  });

  it('getAll returns mapped rows ordered by learned_at', () => {
    const db = makeDb();
    db.query.mockReturnValue([makeRow()]);
    const repository = new StickerRulesRepository(db as never);

    expect(repository.getAll()).toEqual([{
      id: 'sticker_1',
      description: 'when the user is happy',
      reference: makeReference(),
      channel: 'whatsapp',
      enabled: true,
      learned_at: '2026-01-01 00:00:00',
    }]);
    expect(db.query.mock.calls[0][0]).toContain('ORDER BY learned_at DESC');
  });

  it('getRecent filters enabled rules and applies the limit', () => {
    const db = makeDb();
    db.query.mockReturnValue([]);
    const repository = new StickerRulesRepository(db as never);

    repository.getRecent(5);

    expect(db.query.mock.calls[0][0]).toContain('WHERE enabled = 1');
    expect(db.query.mock.calls[0][0]).not.toContain('channel = ?');
    expect(db.query.mock.calls[0][0]).toContain('LIMIT ?');
    expect(db.query.mock.calls[0][1]).toEqual([5]);
  });

  it('getRecent also filters by channel when one is given', () => {
    const db = makeDb();
    db.query.mockReturnValue([]);
    const repository = new StickerRulesRepository(db as never);

    repository.getRecent(5, 'telegram');

    expect(db.query.mock.calls[0][0]).toContain('WHERE enabled = 1');
    expect(db.query.mock.calls[0][0]).toContain('AND channel = ?');
    expect(db.query.mock.calls[0][0]).toContain('LIMIT ?');
    expect(db.query.mock.calls[0][1]).toEqual(['telegram', 5]);
  });

  it('setEnabled updates the enabled column', () => {
    const db = makeDb();
    db.run.mockReturnValueOnce({ changes: 1 });
    const repository = new StickerRulesRepository(db as never);

    expect(repository.setEnabled('a', false)).toBe(true);
    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining('SET enabled = ?'),
      [0, 'a'],
    );

    db.run.mockReturnValueOnce({ changes: 0 });
    expect(repository.setEnabled('a', true)).toBe(false);
  });

  it('deleteById returns true when rows changed', () => {
    const db = makeDb();
    db.run.mockReturnValueOnce({ changes: 1 });
    const repository = new StickerRulesRepository(db as never);

    expect(repository.deleteById('a')).toBe(true);
    expect(db.run).toHaveBeenCalledWith('DELETE FROM sticker_rules WHERE id = ?', ['a']);

    db.run.mockReturnValueOnce({ changes: 0 });
    expect(repository.deleteById('b')).toBe(false);
  });

  it('rethrows when getById fails', () => {
    const db = makeDb();
    db.get.mockImplementation(() => {
      throw new Error('db error');
    });
    const repository = new StickerRulesRepository(db as never);

    expect(() => repository.getById('s1')).toThrow('db error');
  });

  it('rethrows when getAll fails', () => {
    const db = makeDb();
    db.query.mockImplementation(() => {
      throw new Error('db error');
    });
    const repository = new StickerRulesRepository(db as never);

    expect(() => repository.getAll()).toThrow('db error');
  });

  it('rethrows when save fails', () => {
    const db = makeDb();
    db.run.mockImplementation(() => {
      throw new Error('insert failed');
    });
    const repository = new StickerRulesRepository(db as never);

    expect(() => repository.save({ description: 'x', reference: makeReference(), channel: 'whatsapp' })).toThrow('insert failed');
  });

  it('rethrows when deleteById fails', () => {
    const db = makeDb();
    db.run.mockImplementation(() => {
      throw new Error('db error');
    });
    const repository = new StickerRulesRepository(db as never);

    expect(() => repository.deleteById('a')).toThrow('db error');
  });

  it('factory getInstance throws before create is called', () => {
    expect(() => StickerRulesRepositoryFactory.getInstance()).toThrow('not initialized');
  });

  it('factory getInstance returns the created instance', () => {
    const db = makeDb();
    const instance = StickerRulesRepositoryFactory.create(db as never);

    expect(StickerRulesRepositoryFactory.getInstance()).toBe(instance);
  });

  it('factory create returns the same instance when called again', () => {
    const db1 = makeDb();
    const db2 = makeDb();
    const first = StickerRulesRepositoryFactory.create(db1 as never);

    const second = StickerRulesRepositoryFactory.create(db2 as never);

    expect(second).toBe(first);
  });
});
