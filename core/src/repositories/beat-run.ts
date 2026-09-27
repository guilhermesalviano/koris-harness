import { IDatabaseService } from '../infrastructure/db-sqlite';
import { formatISO } from '../utils/date';

export interface BeatRun {
  id: string;
  beatId: string;
  beat: string;
  beatType: string;
  status: 'success' | 'error';
  result?: string;
  errorMessage?: string;
  startedAt: Date;
  finishedAt: Date;
}

interface IBeatRunRepository {
  save(run: BeatRun): void;
  findRecent(limit: number): BeatRun[];
}

class BeatRunRepository implements IBeatRunRepository {
  constructor(private db: IDatabaseService) {}

  save(run: BeatRun): void {
    this.db.run(
      `INSERT INTO beat_runs (id, beat_id, beat, beat_type, status, result, error_message, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.id, run.beatId, run.beat, run.beatType, run.status,
        run.result ?? null, run.errorMessage ?? null, formatISO(run.startedAt), formatISO(run.finishedAt),
      ],
    );
  }

  findRecent(limit: number): BeatRun[] {
    const rows = this.db.query<any>(`SELECT * FROM beat_runs ORDER BY started_at DESC, rowid DESC LIMIT ?`, [limit]);
    return rows.map((row) => ({
      id: row.id,
      beatId: row.beat_id,
      beat: row.beat,
      beatType: row.beat_type,
      status: row.status,
      result: row.result ?? undefined,
      errorMessage: row.error_message ?? undefined,
      startedAt: new Date(row.started_at),
      finishedAt: new Date(row.finished_at),
    }));
  }
}

class BeatRunRepositoryFactory {
  static create(db: IDatabaseService): IBeatRunRepository {
    return new BeatRunRepository(db);
  }
}

export { IBeatRunRepository, BeatRunRepository, BeatRunRepositoryFactory };
