import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseServiceFactory, type IDatabaseService } from '../../src/infrastructure/db-sqlite';
import { MessageRepositoryFactory } from '../../src/repositories/message';
import { SessionRepositoryFactory } from '../../src/repositories/session';
import { Message } from '../../src/entities/message';
import { Session } from '../../src/entities/session';

describe('message sender migration', () => {
  let db: IDatabaseService | undefined;
  let directory: string | undefined;

  afterEach(() => {
    db?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('preserves existing messages while adding durable sender attribution, including repeated startups', () => {
    directory = mkdtempSync(join(tmpdir(), 'koris-message-sender-'));
    const filepath = join(directory, 'database.db');
    db = DatabaseServiceFactory.create({ filepath, verbose: false });
    const parent = new Session({ channel: 'web', peerId: 'web' });
    SessionRepositoryFactory.create(db).save(parent);
    MessageRepositoryFactory.create(db).save(new Message({ id: 'old', sessionId: parent.id, role: 'assistant', content: 'Existing message', createdAt: '2026-09-01T10:00:00.000Z' }));
    db.exec('ALTER TABLE messages DROP COLUMN sender_agent_id');
    db.close();

    db = DatabaseServiceFactory.create({ filepath, verbose: false });
    const repository = MessageRepositoryFactory.create(db);
    expect(repository.getBySessionId(parent.id)[0]).toMatchObject({ id: 'old', content: 'Existing message', senderAgentId: undefined });
    repository.save(new Message({ id: 'new', sessionId: parent.id, role: 'assistant', senderAgentId: 'negotiator', content: 'Booked.', createdAt: '2026-09-01T10:01:00.000Z' }));
    db.close();

    db = DatabaseServiceFactory.create({ filepath, verbose: false });
    expect(MessageRepositoryFactory.create(db).getBySessionId(parent.id).map((message) => [message.id, message.senderAgentId]))
      .toEqual([['old', undefined], ['new', 'negotiator']]);
  });
});
