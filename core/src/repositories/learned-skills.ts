import { IDatabaseService } from '../infrastructure/db-sqlite';
import { LearnedSkill, SaveSkillInput } from '../types/skills';

interface LearnedSkillRow {
  id: string;
  name: string;
  description: string | null;
  read_when: string | null;
  content: string;
  enabled: number;
  learned_at: string;
  [key: string]: unknown;
}

interface ILearnedSkillsRepository {
  save(input: SaveSkillInput): LearnedSkill;
  getById(id: string): LearnedSkill | null;
  getByName(name: string): LearnedSkill | null;
  exists(name: string): boolean;
  getAll(): LearnedSkill[];
  getRecent(limit?: number): LearnedSkill[];
  count(): number;
  updateByName(name: string, input: Partial<SaveSkillInput>): LearnedSkill | null;
  setEnabled(name: string, enabled: boolean): boolean;
  deleteByName(name: string): boolean;
  deleteNotIn(names: string[]): number;
  deleteAll(): number;
}

function serializeReadWhen(readWhen?: string[] | null): string | null {
  return readWhen && readWhen.length > 0 ? JSON.stringify(readWhen) : null;
}

function parseReadWhen(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [raw];
  } catch {
    return [raw];
  }
}

function toLearnedSkill(row: LearnedSkillRow): LearnedSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    read_when: parseReadWhen(row.read_when),
    content: row.content,
    enabled: row.enabled === 1,
    learned_at: row.learned_at,
  };
}

class LearnedSkillsRepository implements ILearnedSkillsRepository {
  constructor(
    private db: IDatabaseService,
  ) {}

  /**
   * Insert a skill or refresh its metadata/content when it was learned before.
   * On conflict the existing enabled flag and learned_at are preserved.
   */
  save(input: SaveSkillInput): LearnedSkill {
    try {
      const id = `skill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      this.db.run(
        `INSERT INTO learned_skills
          (id, name, description, read_when, content, enabled, learned_at)
        VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(name) DO UPDATE SET
          description = excluded.description,
          read_when = excluded.read_when,
          content = excluded.content`,
        [
          id,
          input.name,
          input.description ?? '',
          serializeReadWhen(input.read_when),
          input.content,
        ]
      );

      const skill = this.getByName(input.name);
      if (!skill) {
        throw new Error(`Failed to retrieve saved skill: ${input.name}`);
      }

      return skill;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get learned skill by ID
   */
  getById(id: string): LearnedSkill | null {
    try {
      const skill = this.db.get<LearnedSkillRow>(
        'SELECT * FROM learned_skills WHERE id = ?',
        [id]
      );
      return skill ? toLearnedSkill(skill) : null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get learned skill by name
   */
  getByName(name: string): LearnedSkill | null {
    try {
      const skill = this.db.get<LearnedSkillRow>(
        'SELECT * FROM learned_skills WHERE name = ?',
        [name]
      );
      return skill ? toLearnedSkill(skill) : null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check if skill has been learned
   */
  exists(name: string): boolean {
    try {
      const skill = this.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM learned_skills WHERE name = ?',
        [name]
      );
      return (skill?.count ?? 0) > 0;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all learned skills
   */
  getAll(): LearnedSkill[] {
    try {
      return this.db
        .query<LearnedSkillRow>('SELECT * FROM learned_skills ORDER BY learned_at DESC')
        .map(toLearnedSkill);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get recently learned, enabled skills
   */
  getRecent(limit: number = 10): LearnedSkill[] {
    try {
      return this.db
        .query<LearnedSkillRow>(
          'SELECT * FROM learned_skills WHERE enabled = 1 ORDER BY learned_at DESC LIMIT ?',
          [limit]
        )
        .map(toLearnedSkill);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Count learned skills
   */
  count(): number {
    try {
      const row = this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM learned_skills');
      return row?.count ?? 0;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update the description, read_when hints or content of a learned skill
   */
  updateByName(name: string, input: Partial<SaveSkillInput>): LearnedSkill | null {
    try {
      const existing = this.getByName(name);
      if (!existing) return null;

      this.db.run(
        `UPDATE learned_skills
         SET description = ?, read_when = ?, content = ?
         WHERE name = ?`,
        [
          input.description ?? existing.description,
          input.read_when !== undefined
            ? serializeReadWhen(input.read_when)
            : serializeReadWhen(existing.read_when),
          input.content ?? existing.content,
          name,
        ]
      );

      return this.getByName(name);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Enable or disable a learned skill
   */
  setEnabled(name: string, enabled: boolean): boolean {
    try {
      const result = this.db.run(
        'UPDATE learned_skills SET enabled = ? WHERE name = ?',
        [enabled ? 1 : 0, name]
      );
      return result.changes > 0;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete learned skill by name
   */
  deleteByName(name: string): boolean {
    try {
      const result = this.db.run(
        'DELETE FROM learned_skills WHERE name = ?',
        [name]
      );

      if (result.changes > 0) {
        return true;
      }
      return false;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete all learned skills whose name is not in the given list
   */
  deleteNotIn(names: string[]): number {
    try {
      if (names.length === 0) {
        return this.deleteAll();
      }

      const placeholders = names.map(() => '?').join(', ');
      const result = this.db.run(
        `DELETE FROM learned_skills WHERE name NOT IN (${placeholders})`,
        names
      );
      return result.changes;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Clear all learned skills
   */
  deleteAll(): number {
    try {
      const result = this.db.run('DELETE FROM learned_skills');
      return result.changes;
    } catch (error) {
      throw error;
    }
  }
}

/**
 * Factory for creating LearnedSkillsRepository singleton
 */
class LearnedSkillsRepositoryFactory {
  private static instance: LearnedSkillsRepository;

  static create(db: IDatabaseService): LearnedSkillsRepository {
    if (!this.instance) {
      this.instance = new LearnedSkillsRepository(db);
    }
    return this.instance;
  }

  static getInstance(): LearnedSkillsRepository {
    if (!this.instance) {
      throw new Error('LearnedSkillsRepository not initialized. Call create() first.');
    }
    return this.instance;
  }
}

export { ILearnedSkillsRepository, LearnedSkillsRepository, LearnedSkillsRepositoryFactory }