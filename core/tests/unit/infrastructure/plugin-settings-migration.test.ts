import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DatabaseServiceFactory } from '../../../src/infrastructure/db-sqlite';

function tempDatabase(): string {
  return path.join(tmpdir(), `koris-mcp-migration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('plugin_settings MCP migration', () => {
  it('preserves existing rows and accepts the mcps family', () => {
    const filepath = tempDatabase();
    const legacy = new Database(filepath);
    legacy.exec(`
      CREATE TABLE plugin_settings (
        family TEXT NOT NULL CHECK(family IN ('tools', 'channels')),
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (family, name)
      );
      INSERT INTO plugin_settings (family, name, enabled) VALUES ('tools', 'curl-request', 1);
    `);
    legacy.close();

    const db = DatabaseServiceFactory.create({ filepath, verbose: false });
    expect(db.get<{ enabled: number }>(
      'SELECT enabled FROM plugin_settings WHERE family = ? AND name = ?',
      ['tools', 'curl-request'],
    )?.enabled).toBe(1);
    expect(() => db.run(
      'INSERT INTO plugin_settings (family, name, enabled) VALUES (?, ?, ?)',
      ['mcps', 'local', 0],
    )).not.toThrow();
    db.close();
    if (existsSync(filepath)) unlinkSync(filepath);
  });
});
