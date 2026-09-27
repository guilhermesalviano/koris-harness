import { describe, it, expect, vi } from 'vitest';
import { MemoryService } from '../../../src/services/memory-service';

const SESSION_ID = 'sess-1';

function makeSessionSvc(id = SESSION_ID) {
  return {
    getSession: vi.fn().mockReturnValue({ id }),
    ensureActiveSession: vi.fn().mockReturnValue({ id }),
    updateCount: vi.fn(),
  };
}

function makeRepo(existing: any[] = []) {
  return {
    save: vi.fn(),
    update: vi.fn(),
    getBySessionId: vi.fn().mockReturnValue(existing),
  };
}

describe('MemoryService', () => {
  describe('save', () => {
    it('creates a new memory and saves it to the repository', () => {
      const repo = makeRepo();
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.save({ type: 'fact', content: 'sky is blue' });

      expect(repo.save).toHaveBeenCalledTimes(1);
      const m = repo.save.mock.calls[0][0];
      expect(m.type).toBe('fact');
      expect(m.content).toBe('sky is blue');
      expect(m.sessionId).toBe(SESSION_ID);
    });

    it('forwards optional embedding and tags', () => {
      const repo = makeRepo();
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.save({ type: 'fact', content: 'x', embedding: '[0.1]', tags: 'a, b', importance: 3 });

      const m = repo.save.mock.calls[0][0];
      expect(m.embedding).toBe('[0.1]');
      expect(m.tags).toBe('a, b');
      expect(m.importance).toBe(3);
    });
  });

  describe('upsert', () => {
    it('saves a new memory when none of that type exists', () => {
      const repo = makeRepo([]);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.upsert({ type: 'summary', content: 'first summary' });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('updates existing memory when the same type exists', () => {
      const existing = { id: 'm-1', sessionId: SESSION_ID, type: 'summary', content: 'old', importance: 0, createdAt: new Date() };
      const repo = makeRepo([existing]);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.upsert({ type: 'summary', content: 'new' });

      expect(repo.update).toHaveBeenCalledTimes(1);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('merges distinct content with double newline', () => {
      const existing = { id: 'm-1', sessionId: SESSION_ID, type: 'fact', content: 'old content', importance: 0, createdAt: new Date() };
      const repo = makeRepo([existing]);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.upsert({ type: 'fact', content: 'new content' });

      expect(repo.update.mock.calls[0][0].content).toBe('old content\n\nnew content');
    });

    it('keeps new content when it contains the old content', () => {
      const existing = { id: 'm-1', sessionId: SESSION_ID, type: 'fact', content: 'sky', importance: 0, createdAt: new Date() };
      const repo = makeRepo([existing]);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.upsert({ type: 'fact', content: 'the sky is blue' });

      expect(repo.update.mock.calls[0][0].content).toBe('the sky is blue');
    });

    it('keeps old content when it already contains the new content', () => {
      const existing = { id: 'm-1', sessionId: SESSION_ID, type: 'fact', content: 'the sky is blue', importance: 0, createdAt: new Date() };
      const repo = makeRepo([existing]);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.upsert({ type: 'fact', content: 'sky' });

      expect(repo.update.mock.calls[0][0].content).toBe('the sky is blue');
    });

    it('merges tags deduplicating entries', () => {
      const existing = { id: 'm-1', sessionId: SESSION_ID, type: 'fact', content: 'c', tags: 'a, b', importance: 0, createdAt: new Date() };
      const repo = makeRepo([existing]);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.upsert({ type: 'fact', content: 'c2', tags: 'b, c' });

      expect(repo.update.mock.calls[0][0].tags).toBe('a, b, c');
    });

    it('preserves existing tags when no new tags provided', () => {
      const existing = { id: 'm-1', sessionId: SESSION_ID, type: 'fact', content: 'c', tags: 'a, b', importance: 0, createdAt: new Date() };
      const repo = makeRepo([existing]);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.upsert({ type: 'fact', content: 'c2' });

      expect(repo.update.mock.calls[0][0].tags).toBe('a, b');
    });

    it('takes the higher importance value', () => {
      const existing = { id: 'm-1', sessionId: SESSION_ID, type: 'fact', content: 'c', importance: 3, createdAt: new Date() };
      const repo = makeRepo([existing]);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.upsert({ type: 'fact', content: 'c2', importance: 7 });

      expect(repo.update.mock.calls[0][0].importance).toBe(7);
    });

    it('keeps existing importance when new is lower', () => {
      const existing = { id: 'm-1', sessionId: SESSION_ID, type: 'fact', content: 'c', importance: 8, createdAt: new Date() };
      const repo = makeRepo([existing]);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.upsert({ type: 'fact', content: 'c2', importance: 2 });

      expect(repo.update.mock.calls[0][0].importance).toBe(8);
    });

    it('preserves original id and createdAt on update', () => {
      const createdAt = new Date('2024-01-01');
      const existing = { id: 'original-id', sessionId: SESSION_ID, type: 'fact', content: 'c', importance: 0, createdAt };
      const repo = makeRepo([existing]);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.upsert({ type: 'fact', content: 'updated' });

      const updated = repo.update.mock.calls[0][0];
      expect(updated.id).toBe('original-id');
      expect(updated.createdAt).toEqual(createdAt);
    });
  });

  describe('getAll', () => {
    it('uses the current session id from session service', () => {
      const repo = makeRepo([]);
      const sessionService = makeSessionSvc('sess-a');
      const svc = new MemoryService(repo as any, sessionService as any);
      sessionService.getSession.mockReturnValue({ id: 'sess-b' });

      svc.getAll();

      expect(repo.getBySessionId).toHaveBeenCalledWith('sess-b');
    });

    it('returns all memories for the session', () => {
      const mems = [{ id: 'm1' }, { id: 'm2' }];
      const repo = makeRepo(mems);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      expect(svc.getAll()).toEqual(mems);
    });

    it('queries by the correct session id', () => {
      const repo = makeRepo([]);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      svc.getAll();
      expect(repo.getBySessionId).toHaveBeenCalledWith(SESSION_ID);
    });

    it('returns empty array when no memories exist', () => {
      const repo = makeRepo([]);
      const svc = new MemoryService(repo as any, makeSessionSvc() as any);
      expect(svc.getAll()).toEqual([]);
    });
  });
});
