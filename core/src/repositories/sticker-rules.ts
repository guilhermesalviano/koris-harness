import { IDatabaseService } from '../infrastructure/db-sqlite';
import { StickerRule, SaveStickerRuleInput } from '../types/stickers';
import type { StickerReference } from '../../../plugins/channels/contracts';
import { generateId } from '../utils/generate-id';

interface StickerRuleRow {
  id: string;
  description: string;
  reference: string;
  channel: string;
  enabled: number;
  learned_at: string;
  [key: string]: unknown;
}

interface IStickerRulesRepository {
  save(input: SaveStickerRuleInput): StickerRule;
  getById(id: string): StickerRule | null;
  getAll(): StickerRule[];
  getRecent(limit?: number, channel?: string): StickerRule[];
  setEnabled(id: string, enabled: boolean): boolean;
  deleteById(id: string): boolean;
}

function toStickerRule(row: StickerRuleRow): StickerRule {
  return {
    id: row.id,
    description: row.description,
    reference: JSON.parse(row.reference) as StickerReference,
    channel: row.channel,
    enabled: row.enabled === 1,
    learned_at: row.learned_at,
  };
}

class StickerRulesRepository implements IStickerRulesRepository {
  constructor(
    private db: IDatabaseService,
  ) {}

  save(input: SaveStickerRuleInput): StickerRule {
    try {
      const id = generateId();

      this.db.run(
        `INSERT INTO sticker_rules
          (id, description, reference, channel, enabled, learned_at)
        VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
        [
          id,
          input.description,
          JSON.stringify(input.reference),
          input.channel,
        ]
      );

      const rule = this.getById(id);
      if (!rule) {
        throw new Error(`Failed to retrieve saved sticker rule: ${id}`);
      }

      return rule;
    } catch (error) {
      throw error;
    }
  }

  getById(id: string): StickerRule | null {
    try {
      const row = this.db.get<StickerRuleRow>(
        'SELECT * FROM sticker_rules WHERE id = ?',
        [id]
      );
      return row ? toStickerRule(row) : null;
    } catch (error) {
      throw error;
    }
  }

  getAll(): StickerRule[] {
    try {
      return this.db
        .query<StickerRuleRow>('SELECT * FROM sticker_rules ORDER BY learned_at DESC')
        .map(toStickerRule);
    } catch (error) {
      throw error;
    }
  }

  getRecent(limit: number = 10, channel?: string): StickerRule[] {
    try {
      const sql = channel
        ? 'SELECT * FROM sticker_rules WHERE enabled = 1 AND channel = ? ORDER BY learned_at DESC LIMIT ?'
        : 'SELECT * FROM sticker_rules WHERE enabled = 1 ORDER BY learned_at DESC LIMIT ?';
      const params = channel ? [channel, limit] : [limit];

      return this.db
        .query<StickerRuleRow>(sql, params)
        .map(toStickerRule);
    } catch (error) {
      throw error;
    }
  }

  setEnabled(id: string, enabled: boolean): boolean {
    try {
      const result = this.db.run(
        'UPDATE sticker_rules SET enabled = ? WHERE id = ?',
        [enabled ? 1 : 0, id]
      );
      return result.changes > 0;
    } catch (error) {
      throw error;
    }
  }

  deleteById(id: string): boolean {
    try {
      const result = this.db.run(
        'DELETE FROM sticker_rules WHERE id = ?',
        [id]
      );
      return result.changes > 0;
    } catch (error) {
      throw error;
    }
  }
}

class StickerRulesRepositoryFactory {
  private static instance: StickerRulesRepository;

  static create(db: IDatabaseService): StickerRulesRepository {
    if (!this.instance) {
      this.instance = new StickerRulesRepository(db);
    }
    return this.instance;
  }

  static getInstance(): StickerRulesRepository {
    if (!this.instance) {
      throw new Error('StickerRulesRepository not initialized. Call create() first.');
    }
    return this.instance;
  }
}

export { IStickerRulesRepository, StickerRulesRepository, StickerRulesRepositoryFactory };
