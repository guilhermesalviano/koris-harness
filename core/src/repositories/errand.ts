import { Errand, ErrandProps } from '../entities/errand';
import { IDatabaseService } from '../infrastructure/db-sqlite';
import { camelToSnakeCase } from '../utils/fields';
import { ErrandState } from '../types/errand';

interface ErrandRow {
  id: string;
  goal: string;
  state: ErrandState;
  origin_session_id: string;
  pending_message?: string;
  pending_delivery?: string;
  closing_reply?: string;
  notes?: string;
  result?: string;
  created_at: string;
  last_progress_at?: string;
  closed_at?: string;
}

// Errands still in flight for a target session — anything but the queue
// holding pen and the terminal states. At most one of these may exist per
// target session at a time (enforced by `ErrandService`, not the schema:
// the predicate lives on `errands.state`, not `errand_targets`).
const ACTIVE_STATES: ErrandState[] = ['draft', 'open', 'awaiting_peer', 'awaiting_principal', 'awaiting_confirmation'];

interface IErrandRepository {
  save(errand: Errand): void;
  update(id: string, updates: Partial<ErrandProps>): void;
  findById(id: string): Errand | null;
  findActiveBySessionId(sessionId: string): Errand | null;
  findNextQueuedBySessionId(sessionId: string): Errand | null;
  findActiveByPeer(channel: string, peerIds: string[]): { errand: Errand; sessionId: string } | null;
  findNextQueuedByPeer(channel: string, peerIds: string[]): Errand | null;
  /** The contact's most recently closed `resolved` errand, with its contact session. */
  findLatestResolvedByPeer(channel: string, peerIds: string[]): { errand: Errand; sessionId: string } | null;
  findByOriginSessionId(originSessionId: string): Errand[];
  findAll(state?: ErrandState, limit?: number, offset?: number): Errand[];
  addTarget(errandId: string, sessionId: string): void;
  findTargets(errandId: string): string[];
  countByState(state: ErrandState): number;
}

function mapRowToErrand(row: ErrandRow): Errand {
  return new Errand({
    id: row.id,
    goal: row.goal,
    state: row.state,
    originSessionId: row.origin_session_id,
    pendingMessage: row.pending_message ?? undefined,
    pendingDelivery: row.pending_delivery ? JSON.parse(row.pending_delivery) : undefined,
    closingReply: row.closing_reply ?? undefined,
    notes: row.notes ?? undefined,
    result: row.result ?? undefined,
    createdAt: row.created_at,
    lastProgressAt: row.last_progress_at ?? undefined,
    closedAt: row.closed_at ?? undefined,
  });
}

class ErrandRepository implements IErrandRepository {
  constructor(private db: IDatabaseService) {}

  save(errand: Errand): void {
    this.db.run(
      `INSERT INTO errands (id, goal, state, origin_session_id, pending_message, notes, result, created_at, last_progress_at, closed_at, pending_delivery, closing_reply)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        errand.id,
        errand.goal,
        errand.state,
        errand.originSessionId,
        errand.pendingMessage ?? null,
        errand.notes ?? null,
        errand.result ?? null,
        errand.createdAt,
        errand.lastProgressAt ?? null,
        errand.closedAt ?? null,
        errand.pendingDelivery ? JSON.stringify(errand.pendingDelivery) : null,
        errand.closingReply ?? null,
      ],
    );
  }

  update(id: string, updates: Partial<ErrandProps>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${camelToSnakeCase(key)} = ?`);
      values.push(value === undefined ? null : key === 'pendingDelivery' ? JSON.stringify(value) : value);
    }

    if (fields.length === 0) return;

    values.push(id);

    this.db.run(`UPDATE errands SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  findById(id: string): Errand | null {
    const row = this.db.get('SELECT * FROM errands WHERE id = ?', [id]) as ErrandRow | undefined;
    return row ? mapRowToErrand(row) : null;
  }

  findActiveBySessionId(sessionId: string): Errand | null {
    const placeholders = ACTIVE_STATES.map(() => '?').join(', ');
    const row = this.db.get(
      `SELECT e.* FROM errands e
       JOIN errand_targets t ON t.errand_id = e.id
       WHERE t.session_id = ? AND e.state IN (${placeholders})
       ORDER BY e.created_at DESC
       LIMIT 1`,
      [sessionId, ...ACTIVE_STATES],
    ) as ErrandRow | undefined;
    return row ? mapRowToErrand(row) : null;
  }

  findNextQueuedBySessionId(sessionId: string): Errand | null {
    const row = this.db.get(
      `SELECT e.* FROM errands e
       JOIN errand_targets t ON t.errand_id = e.id
       WHERE t.session_id = ? AND e.state = 'queued'
       ORDER BY e.created_at ASC
       LIMIT 1`,
      [sessionId],
    ) as ErrandRow | undefined;
    return row ? mapRowToErrand(row) : null;
  }

  findByOriginSessionId(originSessionId: string): Errand[] {
    const rows = this.db.query<any>(
      'SELECT * FROM errands WHERE origin_session_id = ? ORDER BY created_at DESC',
      [originSessionId],
    );
    return rows.map(mapRowToErrand);
  }

  // Every errand now has its own session. Contention and inbound routing must
  // match the contact across those sessions, not just the most recent session.
  findActiveByPeer(channel: string, peerIds: string[]): { errand: Errand; sessionId: string } | null {
    if (!peerIds.length) return null;
    const row = this.db.get(
      `SELECT e.*, s.id AS target_session_id FROM errands e
       JOIN errand_targets t ON t.errand_id = e.id
       JOIN sessions s ON s.id = t.session_id
       WHERE s.channel = ? AND s.peer_id IN (${peerIds.map(() => '?').join(', ')})
         AND s.kind = 'delegated' AND s.ended_at IS NULL
         AND e.state IN (${ACTIVE_STATES.map(() => '?').join(', ')})
       ORDER BY e.created_at ASC, e.rowid ASC LIMIT 1`,
      [channel, ...peerIds, ...ACTIVE_STATES],
    ) as (ErrandRow & { target_session_id: string }) | undefined;
    return row ? { errand: mapRowToErrand(row), sessionId: row.target_session_id } : null;
  }

  findNextQueuedByPeer(channel: string, peerIds: string[]): Errand | null {
    if (!peerIds.length) return null;
    const row = this.db.get(
      `SELECT e.* FROM errands e
       JOIN errand_targets t ON t.errand_id = e.id
       JOIN sessions s ON s.id = t.session_id
       WHERE s.channel = ? AND s.peer_id IN (${peerIds.map(() => '?').join(', ')})
         AND s.kind = 'delegated' AND s.ended_at IS NULL AND e.state = 'queued'
       ORDER BY e.created_at ASC, e.rowid ASC LIMIT 1`,
      [channel, ...peerIds],
    ) as ErrandRow | undefined;
    return row ? mapRowToErrand(row) : null;
  }

  findLatestResolvedByPeer(channel: string, peerIds: string[]): { errand: Errand; sessionId: string } | null {
    if (!peerIds.length) return null;
    const row = this.db.get(
      `SELECT e.*, s.id AS target_session_id FROM errands e
       JOIN errand_targets t ON t.errand_id = e.id
       JOIN sessions s ON s.id = t.session_id
       WHERE s.channel = ? AND s.peer_id IN (${peerIds.map(() => '?').join(', ')})
         AND s.kind = 'delegated' AND s.ended_at IS NULL AND e.state = 'resolved'
       ORDER BY e.closed_at DESC, e.rowid DESC LIMIT 1`,
      [channel, ...peerIds],
    ) as (ErrandRow & { target_session_id: string }) | undefined;
    return row ? { errand: mapRowToErrand(row), sessionId: row.target_session_id } : null;
  }

  findAll(state?: ErrandState, limit = 50, offset = 0): Errand[] {
    const rows = state
      ? this.db.query<any>(
          `SELECT * FROM errands WHERE state = ? ORDER BY COALESCE(last_progress_at, created_at) DESC LIMIT ? OFFSET ?`,
          [state, limit, offset],
        )
      : this.db.query<any>(
          `SELECT * FROM errands ORDER BY COALESCE(last_progress_at, created_at) DESC LIMIT ? OFFSET ?`,
          [limit, offset],
        );
    return rows.map(mapRowToErrand);
  }

  addTarget(errandId: string, sessionId: string): void {
    this.db.run(
      'INSERT OR IGNORE INTO errand_targets (errand_id, session_id) VALUES (?, ?)',
      [errandId, sessionId],
    );
  }

  findTargets(errandId: string): string[] {
    const rows = this.db.query<any>(
      'SELECT session_id FROM errand_targets WHERE errand_id = ?',
      [errandId],
    );
    return rows.map((row) => row.session_id);
  }

  countByState(state: ErrandState): number {
    const row = this.db.get('SELECT COUNT(*) as total FROM errands WHERE state = ?', [state]) as
      | { total: number }
      | undefined;
    return row?.total ?? 0;
  }
}

class ErrandRepositoryFactory {
  static create(db: IDatabaseService): ErrandRepository {
    return new ErrandRepository(db);
  }
}

export { IErrandRepository, ErrandRepository, ErrandRepositoryFactory };
