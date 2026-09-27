import { IDatabaseService } from '../infrastructure/db-sqlite';
import { Heartbeat } from '../entities/heartbeat';
import { formatISO } from '../utils/date';

interface UpdateHeartbeatInput {
  beat?: string;
  type?: 'reminder' | 'scheduled_beat';
  cronExpression?: string;
  channel?: string | null;
  target?: string | null;
  managed?: boolean;
  runOnce?: boolean;
}

interface IHeartbeatRepository {
  save(heartbeat: Heartbeat): void;
  getById(id: string): Heartbeat | null;
  getAll(): Heartbeat[];
  update(id: string, input: UpdateHeartbeatInput): Heartbeat | null;
  updateLastRun(id: string, lastRun: Date): void;
  deleteById(id: string): boolean;
  deleteAll(): number;
}

class HeartbeatRepository implements IHeartbeatRepository {
  constructor(private db: IDatabaseService) {}

  save(heartbeat: Heartbeat): void {
    this.db.run(
      `INSERT INTO heartbeat (id, beat, type, cron_expression, last_run, channel, target, managed, run_once, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        heartbeat.id,
        heartbeat.beat,
        heartbeat.type,
        heartbeat.cronExpression,
        heartbeat.lastRun ? formatISO(heartbeat.lastRun) : null,
        heartbeat.channel ?? null,
        heartbeat.target ?? null,
        heartbeat.managed ? 1 : 0,
        heartbeat.runOnce ? 1 : 0,
        formatISO(heartbeat.createdAt),
      ],
    );
  }

  getById(id: string): Heartbeat | null {
    const row = this.db.get<any>(`SELECT * FROM heartbeat WHERE id = ?`, [id]);
    return row ? this.mapRow(row) : null;
  }

  getAll(): Heartbeat[] {
    const rows = this.db.query<any>(`SELECT * FROM heartbeat ORDER BY created_at DESC`);
    return rows.map(this.mapRow);
  }

  update(id: string, input: UpdateHeartbeatInput): Heartbeat | null {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (input.beat !== undefined) {
      fields.push('beat = ?');
      params.push(input.beat);
    }

    if (input.type !== undefined) {
      fields.push('type = ?');
      params.push(input.type);
    }

    if (input.cronExpression !== undefined) {
      fields.push('cron_expression = ?');
      params.push(input.cronExpression);
    }

    if (input.channel !== undefined) {
      fields.push('channel = ?');
      params.push(input.channel);
    }

    if (input.target !== undefined) {
      fields.push('target = ?');
      params.push(input.target);
    }

    if (input.managed !== undefined) {
      fields.push('managed = ?');
      params.push(input.managed ? 1 : 0);
    }

    if (input.runOnce !== undefined) {
      fields.push('run_once = ?');
      params.push(input.runOnce ? 1 : 0);
    }

    if (fields.length === 0) return this.getById(id);

    params.push(id);
    this.db.run(`UPDATE heartbeat SET ${fields.join(', ')} WHERE id = ?`, params);

    return this.getById(id);
  }

  updateLastRun(id: string, lastRun: Date): void {
    this.db.run(`UPDATE heartbeat SET last_run = ? WHERE id = ?`, [formatISO(lastRun), id]);
  }

  deleteById(id: string): boolean {
    const result = this.db.run(`DELETE FROM heartbeat WHERE id = ?`, [id]);
    return result.changes > 0;
  }

  deleteAll(): number {
    const result = this.db.run(`DELETE FROM heartbeat`);
    return result.changes;
  }

  private mapRow(row: any): Heartbeat {
    return new Heartbeat({
      id: row.id,
      beat: row.beat,
      type: row.type,
      cronExpression: row.cron_expression,
      channel: row.channel ?? undefined,
      target: row.target ?? undefined,
      lastRun: row.last_run ? new Date(row.last_run) : undefined,
      managed: row.managed === 1,
      runOnce: row.run_once === 1,
      createdAt: new Date(row.created_at),
    });
  }
}

class HeartbeatRepositoryFactory {
  private static instance: HeartbeatRepository;

  static create(db: IDatabaseService): HeartbeatRepository {
    if (!this.instance) {
      this.instance = new HeartbeatRepository(db);
    }
    return this.instance;
  }

  static getInstance(): HeartbeatRepository {
    if (!this.instance) {
      throw new Error('HeartbeatRepository not initialized. Call create() first.');
    }
    return this.instance;
  }
}

export { IHeartbeatRepository, HeartbeatRepository, HeartbeatRepositoryFactory };
