
import { IDatabaseService } from '../infrastructure/db-sqlite';
import { ILogger } from '../infrastructure/logger';
import { Memory } from '../entities/memory';
import { MemoryType } from '../types/memory';
import { similarity } from 'ml-distance';
import { formatISO } from '../utils/date';

interface IMemoryRepository {
  save(memory: Memory): void;
  update(memory: Memory): void;
  getAll(excludeSessionId?: string): Memory[];
  getBySessionId(sessionId: string): Memory[];
  /** Every memory (reminders included), or only one type, newest first — backs `/memories`. */
  findRecent(limit: number, offset: number, type?: MemoryType): Memory[];
  countAll(type?: MemoryType): number;
  deleteById(id: string): void;
  search(queryEmbedding: number[], limit: number, excludeSessionId?: string): Memory[];
  count(): number;
}

class MemoryRepository implements IMemoryRepository {
  constructor(private db: IDatabaseService, private logger?: ILogger) { }

  save(memory: Memory): void {
    this.db.run(
      `INSERT INTO memories (id, session_id, source, type, content, embedding, tags, importance, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        memory.id,
        memory.sessionId,
        memory.source,
        memory.type,
        memory.content,
        memory.embedding ? JSON.stringify(memory.embedding) : null,
        memory.tags ?? null,
        memory.importance ?? null,
        formatISO(memory.createdAt),
      ]
    );
  }

  update(memory: Memory): void {
    this.db.run(
      `UPDATE memories SET type = ?, content = ?, embedding = ?, tags = ?, importance = ? WHERE id = ?`,
      [
        memory.type,
        memory.content,
        memory.embedding ? JSON.stringify(memory.embedding) : null,
        memory.tags ?? null,
        memory.importance ?? null,
        memory.id,
      ]
    );
  }

  getAll(excludeSessionId?: string): Memory[] {
    let sql = `SELECT id, session_id, source, type, content, embedding, tags, importance, created_at FROM memories`;
    const params: string[] = [];

    sql += ` WHERE type != 'reminder'`;

    if (excludeSessionId) {
      sql += ` AND session_id != ?`;
      params.push(excludeSessionId);
    }

    sql += ` ORDER BY CASE type WHEN 'lesson' THEN 0 WHEN 'fact' THEN 1 WHEN 'summary' THEN 2 ELSE 3 END, created_at DESC`;

    const rows = this.db.query<any>(sql, params);

    return rows.map(this.mapRow);
  }

  getBySessionId(sessionId: string): Memory[] {
    const rows = this.db.query<any>(
      `SELECT id, session_id, source, type, content, embedding, tags, importance, created_at FROM memories
       WHERE session_id = ?
       ORDER BY created_at DESC`,
      [sessionId]
    );

    return rows.map(this.mapRow);
  }

  findRecent(limit: number, offset: number, type?: MemoryType): Memory[] {
    // Embeddings are left out: a listing never needs them and they dominate row size.
    const rows = this.db.query<any>(
      `SELECT id, session_id, source, type, content, tags, importance, created_at FROM memories
       ${type ? 'WHERE type = ?' : ''}
       ORDER BY created_at DESC, rowid DESC
       LIMIT ? OFFSET ?`,
      type ? [type, limit, offset] : [limit, offset]
    );

    return rows.map(this.mapRow);
  }

  countAll(type?: MemoryType): number {
    const row = (type
      ? this.db.get('SELECT COUNT(*) AS total FROM memories WHERE type = ?', [type])
      : this.db.get('SELECT COUNT(*) AS total FROM memories')) as { total?: number } | undefined;
    return row?.total ?? 0;
  }

  search(queryEmbedding: number[], limit: number, excludeSessionId?: string): Memory[] {
    const memories = this.getAll(excludeSessionId);
    const embedded = memories.filter((m): m is Memory & { embedding: number[] } => Array.isArray(m.embedding));

    let dimensionMismatches = 0;
    const scoredMemories = embedded
      .filter((m) => {
        if (m.embedding.length === queryEmbedding.length) return true;
        dimensionMismatches += 1;
        return false;
      })
      .map((m) => ({ memory: m, score: similarity.cosine(queryEmbedding, m.embedding) }))
      .filter((sm) => Number.isFinite(sm.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (dimensionMismatches > 0) {
      this.logger?.warn('Skipped memories with a mismatched embedding dimension during search', {
        skipped: dimensionMismatches,
        queryDimension: queryEmbedding.length,
        hint: 'ai.embed.model likely changed — old memories were embedded with a different model and are no longer comparable',
      });
    }

    return scoredMemories.map((sm) => sm.memory);
  }

  deleteById(id: string): void {
    this.db.run('DELETE FROM memories WHERE id = ?', [id]);
  }

  count(): number {
    const row = this.db.get(
      `SELECT COUNT(*) AS total FROM memories WHERE type != 'reminder'`,
    ) as { total?: number } | undefined;
    return row?.total ?? 0;
  }

  private mapRow(row: any): Memory {
    return new Memory({
      id: row.id,
      sessionId: row.session_id,
      source: row.source,
      type: row.type as MemoryType,
      content: row.content,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      tags: row.tags ?? undefined,
      importance: row.importance ?? undefined,
      createdAt: new Date(row.created_at),
    });
  }
}

class MemoryRepositoryFactory {
  public static create(db: IDatabaseService, logger?: ILogger): MemoryRepository {
    return new MemoryRepository(db, logger);
  }
}

export { IMemoryRepository, MemoryRepository, MemoryRepositoryFactory };