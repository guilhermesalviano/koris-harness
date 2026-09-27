import { describe, it, expect, vi } from 'vitest';
import { LearnedSkillsRepository, LearnedSkillsRepositoryFactory } from '../../../src/repositories/learned-skills';

function makeDb() {
  return { run: vi.fn(), get: vi.fn(), query: vi.fn() };
}

function makeRow(overrides: Partial<{
  id: string;
  name: string;
  description: string | null;
  read_when: string | null;
  content: string;
  enabled: number;
  learned_at: string;
}> = {}) {
  return {
    id: 'skill_1',
    name: 'git',
    description: 'Git workflow skill',
    read_when: null,
    content: 'use rebase',
    enabled: 1,
    learned_at: '2026-01-01 00:00:00',
    ...overrides,
  };
}

describe('LearnedSkillsRepository', () => {
  it('save inserts a new skill and returns the mapped row', () => {
    const db = makeDb();
    const row = makeRow({ read_when: JSON.stringify(['when needed']) });
    db.get.mockReturnValue(row);
    const repository = new LearnedSkillsRepository(db as never);

    const result = repository.save({ name: 'git', description: 'Git workflow skill', read_when: ['when needed'], content: 'use rebase' });

    expect(db.run).toHaveBeenCalledTimes(1);
    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('INSERT INTO learned_skills');
    expect(sql).toContain('ON CONFLICT(name) DO UPDATE');
    expect(params[0]).toMatch(/^skill_\d+_[a-z0-9]{9}$/);
    expect(params[1]).toBe('git');
    expect(params[2]).toBe('Git workflow skill');
    expect(params[3]).toBe(JSON.stringify(['when needed']));
    expect(params[4]).toBe('use rebase');
    expect(result).toEqual({
      id: 'skill_1',
      name: 'git',
      description: 'Git workflow skill',
      read_when: ['when needed'],
      content: 'use rebase',
      enabled: true,
      learned_at: '2026-01-01 00:00:00',
    });
  });

  it('save serializes read_when only when present', () => {
    const db = makeDb();
    db.get.mockReturnValue(makeRow());
    const repository = new LearnedSkillsRepository(db as never);

    repository.save({ name: 'git', content: 'x' });

    const params = db.run.mock.calls[0][1] as unknown[];
    expect(params[3]).toBeNull();
  });

  it('save throws when the inserted skill cannot be retrieved', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new LearnedSkillsRepository(db as never);

    expect(() => repository.save({ name: 'git', content: 'x' })).toThrow(
      'Failed to retrieve saved skill',
    );
  });

  it('getById returns the mapped skill or null', () => {
    const db = makeDb();
    const row = makeRow({ id: 's1', enabled: 0 });
    db.get.mockReturnValueOnce(row);
    const repository = new LearnedSkillsRepository(db as never);

    expect(repository.getById('s1')).toEqual({
      id: 's1',
      name: 'git',
      description: 'Git workflow skill',
      read_when: null,
      content: 'use rebase',
      enabled: false,
      learned_at: '2026-01-01 00:00:00',
    });
    expect(db.get).toHaveBeenCalledWith('SELECT * FROM learned_skills WHERE id = ?', ['s1']);

    db.get.mockReturnValueOnce(undefined);
    expect(repository.getById('missing')).toBeNull();
  });

  it('getByName returns the mapped skill or null', () => {
    const db = makeDb();
    db.get.mockReturnValueOnce(undefined);
    const repository = new LearnedSkillsRepository(db as never);

    expect(repository.getByName('a')).toBeNull();
    expect(db.get).toHaveBeenCalledWith('SELECT * FROM learned_skills WHERE name = ?', ['a']);

    db.get.mockReturnValueOnce(makeRow());
    expect(repository.getByName('a')?.id).toBe('skill_1');
  });

  it('parses read_when stored as non-JSON text defensively', () => {
    const db = makeDb();
    db.get.mockReturnValueOnce(makeRow({ read_when: 'plain hint' }));
    const repository = new LearnedSkillsRepository(db as never);

    expect(repository.getByName('a')?.read_when).toEqual(['plain hint']);
  });

  it('exists returns true only when the count is greater than zero', () => {
    const db = makeDb();
    db.get.mockReturnValueOnce({ count: 3 });
    const repository = new LearnedSkillsRepository(db as never);

    expect(repository.exists('a')).toBe(true);
    expect(db.get).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM learned_skills WHERE name = ?', ['a']);

    db.get.mockReturnValueOnce({ count: 0 });
    expect(repository.exists('b')).toBe(false);
  });

  it('exists returns false when no count row is returned', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new LearnedSkillsRepository(db as never);

    expect(repository.exists('a')).toBe(false);
  });

  it('getAll returns mapped rows ordered by learned_at', () => {
    const db = makeDb();
    const rows = [makeRow()];
    db.query.mockReturnValue(rows);
    const repository = new LearnedSkillsRepository(db as never);

    expect(repository.getAll()).toEqual([{
      id: 'skill_1',
      name: 'git',
      description: 'Git workflow skill',
      read_when: null,
      content: 'use rebase',
      enabled: true,
      learned_at: '2026-01-01 00:00:00',
    }]);
    expect(db.query.mock.calls[0][0]).toContain('ORDER BY learned_at DESC');
  });

  it('getRecent filters enabled skills and applies the limit', () => {
    const db = makeDb();
    db.query.mockReturnValue([]);
    const repository = new LearnedSkillsRepository(db as never);

    repository.getRecent(5);

    expect(db.query.mock.calls[0][0]).toContain('WHERE enabled = 1');
    expect(db.query.mock.calls[0][0]).toContain('LIMIT ?');
    expect(db.query.mock.calls[0][1]).toEqual([5]);
  });

  it('count returns the number of learned skills', () => {
    const db = makeDb();
    db.get.mockReturnValueOnce({ count: 7 });
    const repository = new LearnedSkillsRepository(db as never);

    expect(repository.count()).toBe(7);
    expect(db.get).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM learned_skills');

    db.get.mockReturnValueOnce(undefined);
    expect(repository.count()).toBe(0);
  });

  it('updateByName updates fields and returns the refreshed skill', () => {
    const db = makeDb();
    db.get
      .mockReturnValueOnce(makeRow())
      .mockReturnValueOnce(makeRow({ description: 'updated', read_when: JSON.stringify(['later']) }));
    const repository = new LearnedSkillsRepository(db as never);

    const result = repository.updateByName('git', { description: 'updated', read_when: ['later'] });

    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE learned_skills'),
      ['updated', JSON.stringify(['later']), 'use rebase', 'git'],
    );
    expect(result?.description).toBe('updated');
    expect(result?.read_when).toEqual(['later']);
  });

  it('updateByName returns null when the skill does not exist', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new LearnedSkillsRepository(db as never);

    expect(repository.updateByName('git', {})).toBeNull();
    expect(db.run).not.toHaveBeenCalled();
  });

  it('setEnabled updates the enabled column', () => {
    const db = makeDb();
    db.run.mockReturnValueOnce({ changes: 1 });
    const repository = new LearnedSkillsRepository(db as never);

    expect(repository.setEnabled('a', false)).toBe(true);
    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining('SET enabled = ?'),
      [0, 'a'],
    );

    db.run.mockReturnValueOnce({ changes: 0 });
    expect(repository.setEnabled('a', true)).toBe(false);
  });

  it('deleteByName returns true when rows changed', () => {
    const db = makeDb();
    db.run.mockReturnValueOnce({ changes: 1 });
    const repository = new LearnedSkillsRepository(db as never);

    expect(repository.deleteByName('a')).toBe(true);
    expect(db.run).toHaveBeenCalledWith('DELETE FROM learned_skills WHERE name = ?', ['a']);

    db.run.mockReturnValueOnce({ changes: 0 });
    expect(repository.deleteByName('b')).toBe(false);
  });

  it('deleteAll returns the number of deleted rows', () => {
    const db = makeDb();
    db.run.mockReturnValue({ changes: 4 });
    const repository = new LearnedSkillsRepository(db as never);

    expect(repository.deleteAll()).toBe(4);
    expect(db.run).toHaveBeenCalledWith('DELETE FROM learned_skills');
  });

  it('deleteNotIn deletes skills not in the keep list', () => {
    const db = makeDb();
    db.run.mockReturnValue({ changes: 2 });
    const repository = new LearnedSkillsRepository(db as never);

    const result = repository.deleteNotIn(['git', 'docker']);

    expect(result).toBe(2);
    expect(db.run).toHaveBeenCalledWith(
      'DELETE FROM learned_skills WHERE name NOT IN (?, ?)',
      ['git', 'docker'],
    );
  });

  it('deleteNotIn clears everything when the keep list is empty', () => {
    const db = makeDb();
    db.run.mockReturnValue({ changes: 5 });
    const repository = new LearnedSkillsRepository(db as never);

    expect(repository.deleteNotIn([])).toBe(5);
    expect(db.run).toHaveBeenCalledWith('DELETE FROM learned_skills');
  });

  it('rethrows when getById fails', () => {
    const db = makeDb();
    db.get.mockImplementation(() => {
      throw new Error('db error');
    });
    const repository = new LearnedSkillsRepository(db as never);

    expect(() => repository.getById('s1')).toThrow('db error');
  });

  it('rethrows when getByName fails', () => {
    const db = makeDb();
    db.get.mockImplementation(() => {
      throw new Error('db error');
    });
    const repository = new LearnedSkillsRepository(db as never);

    expect(() => repository.getByName('git')).toThrow('db error');
  });

  it('rethrows when exists fails', () => {
    const db = makeDb();
    db.get.mockImplementation(() => {
      throw new Error('db error');
    });
    const repository = new LearnedSkillsRepository(db as never);

    expect(() => repository.exists('git')).toThrow('db error');
  });

  it('rethrows when getAll fails', () => {
    const db = makeDb();
    db.query.mockImplementation(() => {
      throw new Error('db error');
    });
    const repository = new LearnedSkillsRepository(db as never);

    expect(() => repository.getAll()).toThrow('db error');
  });

  it('rethrows when getRecent fails', () => {
    const db = makeDb();
    db.query.mockImplementation(() => {
      throw new Error('db error');
    });
    const repository = new LearnedSkillsRepository(db as never);

    expect(() => repository.getRecent()).toThrow('db error');
  });

  it('rethrows when save fails', () => {
    const db = makeDb();
    db.run.mockImplementation(() => {
      throw new Error('insert failed');
    });
    const repository = new LearnedSkillsRepository(db as never);

    expect(() => repository.save({ name: 'git', content: 'x' })).toThrow('insert failed');
  });

  it('rethrows when deleteByName fails', () => {
    const db = makeDb();
    db.run.mockImplementation(() => {
      throw new Error('db error');
    });
    const repository = new LearnedSkillsRepository(db as never);

    expect(() => repository.deleteByName('git')).toThrow('db error');
  });

  it('rethrows when deleteAll fails', () => {
    const db = makeDb();
    db.run.mockImplementation(() => {
      throw new Error('db error');
    });
    const repository = new LearnedSkillsRepository(db as never);

    expect(() => repository.deleteAll()).toThrow('db error');
  });

  it('factory getInstance throws before create is called', () => {
    expect(() => LearnedSkillsRepositoryFactory.getInstance()).toThrow('not initialized');
  });

  it('factory getInstance returns the created instance', () => {
    const db = makeDb();
    const instance = LearnedSkillsRepositoryFactory.create(db as never);

    expect(LearnedSkillsRepositoryFactory.getInstance()).toBe(instance);
  });

  it('factory create returns the same instance when called again', () => {
    const db1 = makeDb();
    const db2 = makeDb();
    const first = LearnedSkillsRepositoryFactory.create(db1 as never);

    const second = LearnedSkillsRepositoryFactory.create(db2 as never);

    expect(second).toBe(first);
  });
});