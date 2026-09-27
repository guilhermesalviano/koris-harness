import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DatabaseServiceFactory } from '../../../src/infrastructure/db-sqlite';

function tempDatabase(): string {
  return path.join(tmpdir(), `koris-run-once-migration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('heartbeat run_once migration', () => {
  it('adds the column to an existing table and keeps existing beats recurring', () => {
    const filepath = tempDatabase();
    const legacy = new Database(filepath);
    legacy.exec(`
      CREATE TABLE heartbeat (
        id TEXT PRIMARY KEY,
        beat TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('reminder', 'scheduled_beat')),
        cron_expression TEXT NOT NULL,
        last_run DATETIME,
        channel TEXT,
        target TEXT,
        managed INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO heartbeat (id, beat, type, cron_expression) VALUES ('h1', 'call mom', 'reminder', '30 9 15 6 *');
    `);
    legacy.close();

    const db = DatabaseServiceFactory.create({ filepath, verbose: false });
    expect(db.get<{ run_once: number }>('SELECT run_once FROM heartbeat WHERE id = ?', ['h1'])?.run_once).toBe(0);
    db.close();

    // Re-opening an already-migrated database must not try to add the column again.
    expect(() => DatabaseServiceFactory.create({ filepath, verbose: false }).close()).not.toThrow();
    if (existsSync(filepath)) unlinkSync(filepath);
  });
});
