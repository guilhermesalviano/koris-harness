import { IDatabaseService } from '../infrastructure/db-sqlite';
import { HeartbeatRun } from '../entities/heartbeat-run';
import { formatISO } from '../utils/date';

interface RecordHeartbeatRunInput {
  runAt: Date;
  status: 'success' | 'error';
  errorMessage?: string;
}

interface IHeartbeatRunRepository {
  recordRun(input: RecordHeartbeatRunInput): void;
  getLastRun(): HeartbeatRun | null;
}

class HeartbeatRunRepository implements IHeartbeatRunRepository {
  constructor(private db: IDatabaseService) {}

  recordRun(input: RecordHeartbeatRunInput): void {
    const run = new HeartbeatRun({ ...input });
    this.db.run(
      `INSERT INTO heartbeat_runs (id, run_at, status, error_message) VALUES (?, ?, ?, ?)`,
      [run.id, formatISO(run.runAt), run.status, run.errorMessage ?? null],
    );
  }

  getLastRun(): HeartbeatRun | null {
    const row = this.db.get<any>(`SELECT * FROM heartbeat_runs ORDER BY run_at DESC LIMIT 1`);
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: any): HeartbeatRun {
    return new HeartbeatRun({
      id: row.id,
      runAt: new Date(row.run_at),
      status: row.status,
      errorMessage: row.error_message ?? undefined,
      createdAt: new Date(row.created_at),
    });
  }
}

class HeartbeatRunRepositoryFactory {
  private static instance: HeartbeatRunRepository;

  static create(db: IDatabaseService): HeartbeatRunRepository {
    if (!this.instance) {
      this.instance = new HeartbeatRunRepository(db);
    }
    return this.instance;
  }

  static getInstance(): HeartbeatRunRepository {
    if (!this.instance) {
      throw new Error('HeartbeatRunRepository not initialized. Call create() first.');
    }
    return this.instance;
  }
}

export { IHeartbeatRunRepository, HeartbeatRunRepository, HeartbeatRunRepositoryFactory };
