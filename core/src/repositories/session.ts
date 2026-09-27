import { Session, SessionProps } from '../entities/session';
import { IDatabaseService } from '../infrastructure/db-sqlite';
import { camelToSnakeCase } from '../utils/fields';
import { SessionKey, SessionKind } from '../types/session';

interface SessionRow {
  id: string;
  channel: string;
  peer_id: string;
  kind: SessionKind;
  started_at?: string;
  ended_at?: string;
  message_count?: number;
  metadata?: string;
}

interface ISessionRepository {
  save(session: Session): void;
  update(id: string, updates: Partial<SessionProps>): void;
  findById(id: string): Session | null;
  findLatestOpen(key: SessionKey): Session | null;
  findAll(limit?: number, offset?: number, kind?: SessionKind): Session[];
  count(kind?: SessionKind): number;
  countOpen(): number;
  deleteById(id: string): void;
  /** Atomically end `endingId` and insert `newSession` — a partial failure
   * must never leave the channel with zero open sessions. */
  rotate(endingId: string, endedAt: string, newSession: Session): void;
}

function mapRowToSession(row: SessionRow): Session {
  let metadata: Record<string, unknown> = {};

  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      metadata = {};
    }
  }

  return new Session({
    id: row.id,
    channel: row.channel,
    peerId: row.peer_id,
    kind: row.kind,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    messageCount: row.message_count,
    metadata,
  });
}

class SessionRepository implements ISessionRepository {
  constructor(private db: IDatabaseService) { }

  save(session: Session): void {
    this.db.run(
      `INSERT INTO sessions (id, channel, peer_id, kind, started_at, ended_at, message_count, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.channel,
        session.peerId,
        session.kind,
        session.startedAt,
        session.endedAt,
        session.messageCount,
        JSON.stringify(session.metadata),
      ]
    );
  }

  update(id: string, updates: Partial<SessionProps>): void {
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${camelToSnakeCase(key)} = ?`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    }

    if (fields.length === 0) return;

    values.push(id);

    this.db.run(
      `UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }

  findById(id: string): Session | null {
    const row = this.db.get('SELECT * FROM sessions WHERE id = ?', [id]) as SessionRow | undefined;

    if (!row) return null;

    return mapRowToSession(row);
  }

  findLatestOpen(key: SessionKey): Session | null {
    const row = this.db.get(
      `SELECT * FROM sessions
       WHERE channel = ? AND peer_id = ? AND kind = ? AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`,
      [key.channel, key.peerId, key.kind ?? 'user'],
    ) as SessionRow | undefined;

    if (!row) return null;

    return mapRowToSession(row);
  }

  findAll(limit = 50, offset = 0, kind?: SessionKind): Session[] {
    const rows = kind
      ? this.db.query<any>(
          `SELECT * FROM sessions WHERE kind = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`,
          [kind, limit, offset],
        )
      : this.db.query<any>(
          `SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?`,
          [limit, offset],
        );

    return rows.map((row: SessionRow) => mapRowToSession(row));
  }

  count(kind?: SessionKind): number {
    const row = kind
      ? (this.db.get('SELECT COUNT(*) as total FROM sessions WHERE kind = ?', [kind]) as { total: number } | undefined)
      : (this.db.get('SELECT COUNT(*) as total FROM sessions') as { total: number } | undefined);
    return row?.total ?? 0;
  }

  countOpen(): number {
    const row = this.db.get(
      'SELECT COUNT(*) as total FROM sessions WHERE ended_at IS NULL',
    ) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  deleteById(id: string): void {
    this.db.run('DELETE FROM sessions WHERE id = ?', [id]);
  }

  rotate(endingId: string, endedAt: string, newSession: Session): void {
    this.db.transaction(() => {
      this.db.run('UPDATE sessions SET ended_at = ? WHERE id = ?', [endedAt, endingId]);
      this.save(newSession);
    });
  }
}

class SessionRepositoryFactory {
  public static create(db: IDatabaseService): SessionRepository {
    return new SessionRepository(db);
  }
}

export { ISessionRepository, SessionRepository, SessionRepositoryFactory };
