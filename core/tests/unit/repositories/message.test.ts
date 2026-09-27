import { describe, it, expect, vi } from 'vitest';
import { MessageRepository } from '../../../src/repositories/message';
import { Message } from '../../../src/entities/message';

function makeDb(rows: any[] = []) {
  return {
    query: vi.fn().mockReturnValue(rows),
    get: vi.fn().mockReturnValue(rows[0]),
    run: vi.fn(),
  };
}

function makeImageRepo(images: any[] = []) {
  return {
    save: vi.fn(),
    getByIds: vi.fn().mockReturnValue(images),
  };
}

function makeRepository(db: any, imageRepo: any = makeImageRepo()) {
  return new MessageRepository(db, imageRepo);
}

describe('MessageRepository', () => {
  it('deletes a message by id and counts every stored message', () => {
    const db = makeDb();
    const repository = makeRepository(db);
    repository.deleteById('m1');
    expect(db.run).toHaveBeenCalledWith('DELETE FROM messages WHERE id = ?', ['m1']);

    db.get.mockReturnValue({ total: 42 });
    expect(repository.count()).toBe(42);
    db.get.mockReturnValue(undefined);
    expect(repository.count()).toBe(0);
  });

  it('spans every peer on a channel when the timeline key has no peer', () => {
    const db = makeDb([]);
    const repository = makeRepository(db);
    repository.getTimeline({ key: { channel: 'negotiator', kind: 'user' }, limit: 10 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toContain('s.peer_id = ?');
    expect(params).toEqual(['negotiator', 'user', 11]);
  });

  it('fetches the latest N messages while returning them in chronological order', () => {
    const db = makeDb([
      {
        id: 'm2',
        session_id: 'sess-1',
        role: 'assistant',
        content: 'second',
        created_at: '2026-05-01T12:00:01.000Z',
      },
      {
        id: 'm3',
        session_id: 'sess-1',
        role: 'user',
        content: 'third',
        created_at: '2026-05-01T12:00:02.000Z',
      },
    ]);
    const repository = makeRepository(db);

    const messages = repository.getBySessionId('sess-1', 2);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(sql).toContain('LIMIT ?');
    expect(sql).toContain('ORDER BY created_at ASC');
    expect(params).toEqual(['sess-1', 2]);
    expect(messages.map((message) => message.id)).toEqual(['m2', 'm3']);
  });

  it('uses the default limit when no limit is provided', () => {
    const db = makeDb([]);
    const repository = makeRepository(db);

    repository.getBySessionId('sess-1');

    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual(['sess-1', 15]);
  });

  it('persists each image to the images table and stores its id on the message', () => {
    const db = makeDb([]);
    const imageRepo = makeImageRepo();
    const repository = makeRepository(db, imageRepo);

    repository.save(new Message({
      sessionId: 'sess-1',
      role: 'user',
      content: 'describe',
      images: [
        { data: 'aGVsbG8=', mimeType: 'image/png' },
        { data: 'd29ybGQ=', mimeType: 'image/jpeg' },
      ],
      id: 'm1',
      createdAt: '2026-05-01T12:00:00.000Z',
    }));

    expect(imageRepo.save).toHaveBeenCalledTimes(2);
    const saved = imageRepo.save.mock.calls.map((call) => call[0]);
    expect(saved[0].data).toBe('aGVsbG8=');
    expect(saved[0].mimeType).toBe('image/png');
    expect(saved[1].data).toBe('d29ybGQ=');
    expect(saved[1].mimeType).toBe('image/jpeg');
    expect(saved.every((image: any) => typeof image.id === 'string' && image.id.length > 0)).toBe(true);

    const [, params] = db.run.mock.calls[0];
    const storedIds = JSON.parse(params[4]);
    expect(storedIds).toEqual([saved[0].id, saved[1].id]);
  });

  it('stores null image_ids when a message has no attachments', () => {
    const db = makeDb([]);
    const imageRepo = makeImageRepo();
    const repository = makeRepository(db, imageRepo);

    repository.save(new Message({
      sessionId: 'sess-1',
      role: 'user',
      content: 'hi',
      id: 'm1',
      createdAt: '2026-05-01T12:00:00.000Z',
    }));

    expect(imageRepo.save).not.toHaveBeenCalled();
    const [, params] = db.run.mock.calls[0];
    expect(params[4]).toBeNull();
  });

  it('stores error_code on save and reads it back as errorCode', () => {
    const db = makeDb([
      {
        id: 'm1',
        session_id: 'sess-1',
        role: 'assistant',
        content: 'Rate limit exceeded',
        error_code: 'rate_limited',
        created_at: '2026-05-01T12:00:00.000Z',
      },
      {
        id: 'm2',
        session_id: 'sess-1',
        role: 'assistant',
        content: 'ok',
        created_at: '2026-05-01T12:00:01.000Z',
      },
    ]);
    const repository = makeRepository(db);

    repository.save(new Message({
      sessionId: 'sess-1',
      role: 'assistant',
      content: 'Rate limit exceeded',
      errorCode: 'rate_limited',
      id: 'm1',
      createdAt: '2026-05-01T12:00:00.000Z',
    }));
    const [, params] = db.run.mock.calls[0];
    expect(params[5]).toBe('rate_limited');

    const [errored, normal] = repository.getBySessionId('sess-1', 2);
    expect(errored.errorCode).toBe('rate_limited');
    expect(normal.errorCode).toBeUndefined();
  });

  it('writes null error_code for a normal message', () => {
    const db = makeDb([]);
    const repository = makeRepository(db);

    repository.save(new Message({ sessionId: 'sess-1', role: 'user', content: 'hi', id: 'm1', createdAt: '2026-05-01T12:00:00.000Z' }));

    const [, params] = db.run.mock.calls[0];
    expect(params[5]).toBeNull();
  });

  it('resolves image ids back into image attachments when reading history', () => {
    const db = makeDb([
      {
        id: 'm1',
        session_id: 'sess-1',
        role: 'user',
        content: 'describe',
        image_ids: JSON.stringify(['img-1']),
        created_at: '2026-05-01T12:00:00.000Z',
      },
    ]);
    const imageRepo = makeImageRepo([{ id: 'img-1', data: 'aGVsbG8=', mimeType: 'image/png' }]);
    const repository = makeRepository(db, imageRepo);

    const [message] = repository.getBySessionId('sess-1', 1);

    expect(imageRepo.getByIds).toHaveBeenCalledWith(['img-1']);
    expect(message.images).toEqual([{ data: 'aGVsbG8=', mimeType: 'image/png' }]);
  });

  it('leaves images undefined when a message has no image ids', () => {
    const db = makeDb([
      {
        id: 'm1',
        session_id: 'sess-1',
        role: 'user',
        content: 'plain',
        created_at: '2026-05-01T12:00:00.000Z',
      },
    ]);
    const imageRepo = makeImageRepo();
    const repository = makeRepository(db, imageRepo);

    const [message] = repository.getBySessionId('sess-1', 1);

    expect(imageRepo.getByIds).toHaveBeenCalledWith([]);
    expect(message.images).toBeUndefined();
    expect(message.missingImages).toBeUndefined();
  });

  it('reports the number of referenced images that were deleted', () => {
    const db = makeDb([
      {
        id: 'm1',
        session_id: 'sess-1',
        role: 'user',
        content: 'describe',
        image_ids: JSON.stringify(['img-1', 'img-2']),
        created_at: '2026-05-01T12:00:00.000Z',
      },
    ]);
    const imageRepo = makeImageRepo([{ id: 'img-1', data: 'aGVsbG8=', mimeType: 'image/png' }]);
    const repository = makeRepository(db, imageRepo);

    const [message] = repository.getBySessionId('sess-1', 1);

    expect(message.images).toEqual([{ data: 'aGVsbG8=', mimeType: 'image/png' }]);
    expect(message.missingImages).toBe(1);
  });

  it('reports all images as missing when none of the referenced rows exist', () => {
    const db = makeDb([
      {
        id: 'm1',
        session_id: 'sess-1',
        role: 'user',
        content: 'describe',
        image_ids: JSON.stringify(['img-1', 'img-2']),
        created_at: '2026-05-01T12:00:00.000Z',
      },
    ]);
    const imageRepo = makeImageRepo();
    const repository = makeRepository(db, imageRepo);

    const [message] = repository.getBySessionId('sess-1', 1);

    expect(message.images).toBeUndefined();
    expect(message.missingImages).toBe(2);
  });

  it('fetches the first user message as the session preview', () => {
    const db = makeDb([{ content: 'hello there' }]);
    const repository = makeRepository(db);

    const preview = repository.getPreviewBySessionId('sess-1');

    const [sql, params] = db.get.mock.calls[0];
    expect(sql).toContain("role = 'user'");
    expect(sql).toContain('ORDER BY created_at ASC');
    expect(params).toEqual(['sess-1']);
    expect(preview).toBe('hello there');
  });

  it('returns null when the session has no user message', () => {
    const db = makeDb([undefined]);
    const repository = makeRepository(db);

    expect(repository.getPreviewBySessionId('sess-1')).toBeNull();
  });
});
