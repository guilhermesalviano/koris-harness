import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseServiceFactory, type IDatabaseService } from '../../src/infrastructure/db-sqlite';
import { BeatRunRepositoryFactory } from '../../src/repositories/beat-run';

describe('beat run history', () => {
  let db: IDatabaseService | undefined;
  let directory: string | undefined;

  afterEach(() => {
    db?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('stores runs and returns the latest first, up to the limit', () => {
    directory = mkdtempSync(join(tmpdir(), 'koris-beat-runs-'));
    db = DatabaseServiceFactory.create({ filepath: join(directory, 'database.db'), verbose: false });
    const runs = BeatRunRepositoryFactory.create(db);
    const at = (minute: number) => new Date(Date.UTC(2026, 8, 13, 9, minute));
    runs.save({ id: 'r1', beatId: 'b1', beat: 'Weather', beatType: 'scheduled_beat', status: 'success', result: 'Sunny', startedAt: at(0), finishedAt: at(1) });
    runs.save({ id: 'r2', beatId: 'b1', beat: 'Weather', beatType: 'scheduled_beat', status: 'error', errorMessage: 'timeout', startedAt: at(10), finishedAt: at(11) });
    runs.save({ id: 'r3', beatId: 'b2', beat: 'Call mom', beatType: 'reminder', status: 'success', result: 'Done', startedAt: at(5), finishedAt: at(6) });

    const recent = runs.findRecent(2);
    expect(recent.map((run) => run.id)).toEqual(['r2', 'r3']);
    expect(recent[0]).toMatchObject({ status: 'error', errorMessage: 'timeout', result: undefined });
    expect(recent[0].startedAt.getTime()).toBe(at(10).getTime());
    expect(runs.findRecent(5)[2]).toMatchObject({ id: 'r1', beatType: 'scheduled_beat', result: 'Sunny' });
  });
});
