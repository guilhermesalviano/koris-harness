import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseServiceFactory, type IDatabaseService } from '../../src/infrastructure/db-sqlite';

const connections: IDatabaseService[] = [];
const directories: string[] = [];
afterEach(() => {
  connections.splice(0).forEach((connection) => connection.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('local database backup', () => {
  it.each(["backup's copy.db", "snapshot'; DROP TABLE backup_test; --.db"])
    ('backs up to a filename containing SQL punctuation: %s', (filename) => {
      const directory = mkdtempSync(join(tmpdir(), 'koris-backup-'));
      directories.push(directory);
      const database = DatabaseServiceFactory.create({ filepath: join(directory, 'source.db') });
      connections.push(database);
      database.exec('CREATE TABLE backup_test (content TEXT)');
      database.run('INSERT INTO backup_test (content) VALUES (?)', ['keep my data']);
      const destination = join(directory, filename);
      database.backup(destination);
      const backup = DatabaseServiceFactory.create({ filepath: destination });
      connections.push(backup);
      expect(backup.get('SELECT content FROM backup_test')).toEqual({ content: 'keep my data' });
      expect(database.get('SELECT content FROM backup_test')).toEqual({ content: 'keep my data' });
    });
});
