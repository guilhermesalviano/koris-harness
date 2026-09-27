import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DatabaseServiceFactory } from '../../../src/infrastructure/db-sqlite';

function tempDatabase(): string {
  return path.join(tmpdir(), `koris-errands-migration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('errands awaiting_confirmation migration', () => {
  it('keeps errands and their targets, and accepts the new state and closing reply', () => {
    const filepath = tempDatabase();
    const legacy = new Database(filepath);
    legacy.pragma('foreign_keys = ON');
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'user' CHECK(kind IN ('user', 'delegated')),
        started_at DATETIME,
        ended_at DATETIME,
        message_count INTEGER DEFAULT 0,
        metadata TEXT
      );
      CREATE TABLE errands (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN (
          'draft','queued','open','awaiting_peer','awaiting_principal',
          'resolved','failed','cancelled','expired')),
        origin_session_id TEXT NOT NULL,
        pending_message TEXT,
        pending_delivery TEXT,
        notes TEXT,
        result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_progress_at DATETIME,
        closed_at DATETIME,
        FOREIGN KEY (origin_session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE TABLE errand_targets (
        errand_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        PRIMARY KEY (errand_id, session_id),
        FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      INSERT INTO sessions (id, channel, peer_id, kind) VALUES ('parent', 'web', 'web', 'user'), ('contact', 'whatsapp', '555', 'delegated');
      INSERT INTO errands (id, goal, state, origin_session_id, notes) VALUES ('e1', 'Book a haircut', 'awaiting_peer', 'parent', 'Saturday at 11');
      INSERT INTO errand_targets (errand_id, session_id) VALUES ('e1', 'contact');
    `);
    legacy.close();

    const db = DatabaseServiceFactory.create({ filepath, verbose: false });
    expect(db.get<{ goal: string; notes: string }>('SELECT goal, notes FROM errands WHERE id = ?', ['e1'])).toEqual({ goal: 'Book a haircut', notes: 'Saturday at 11' });
    expect(db.query('SELECT errand_id, session_id FROM errand_targets')).toEqual([{ errand_id: 'e1', session_id: 'contact' }]);
    expect(() => db.run(
      'UPDATE errands SET state = ?, closing_reply = ? WHERE id = ?',
      ['awaiting_confirmation', 'Thank you!', 'e1'],
    )).not.toThrow();
    expect(db.get<{ state: string; closing_reply: string }>('SELECT state, closing_reply FROM errands WHERE id = ?', ['e1']))
      .toEqual({ state: 'awaiting_confirmation', closing_reply: 'Thank you!' });

    // Foreign keys are back on after the rebuild: deleting the errand still cascades to its targets.
    db.run('DELETE FROM errands WHERE id = ?', ['e1']);
    expect(db.query('SELECT * FROM errand_targets')).toEqual([]);
    db.close();

    // Reopening an already migrated database leaves it alone.
    const reopened = DatabaseServiceFactory.create({ filepath, verbose: false });
    expect(reopened.get<{ total: number }>('SELECT COUNT(*) AS total FROM sessions')?.total).toBe(2);
    reopened.close();
    if (existsSync(filepath)) unlinkSync(filepath);
  });
});
