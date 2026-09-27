import { describe, it, expect, vi } from 'vitest';
import { MessageService } from '../../../src/services/message-service';

function makeRepo(messages: any[] = []) {
  return {
    save: vi.fn(),
    getBySessionId: vi.fn().mockReturnValue(messages),
  };
}

function makeSessionSvc(id = 'sess-1') {
  return {
    getSession: vi.fn().mockReturnValue({ id, kind: 'user' }),
    ensureActiveSession: vi.fn().mockReturnValue({ id, kind: 'user' }),
    updateCount: vi.fn(),
  };
}

describe('MessageService', () => {
  describe('save', () => {
    it('calls repo.save with a message containing the correct role and content', () => {
      const repo = makeRepo();
      const session = makeSessionSvc();
      const svc = new MessageService(repo as any, session as any);

      svc.save({ role: 'user', content: 'hello' });

      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = repo.save.mock.calls[0][0];
      expect(saved.role).toBe('user');
      expect(saved.content).toBe('hello');
    });

    it('attaches the session id to the saved message', () => {
      const repo = makeRepo();
      const session = makeSessionSvc('my-session');
      const svc = new MessageService(repo as any, session as any);

      svc.save({ role: 'assistant', content: 'hi' });

      expect(repo.save.mock.calls[0][0].sessionId).toBe('my-session');
    });

    it('calls session.updateCount after saving', () => {
      const repo = makeRepo();
      const session = makeSessionSvc();
      const svc = new MessageService(repo as any, session as any);

      svc.save({ role: 'user', content: 'msg' });

      expect(session.updateCount).toHaveBeenCalledTimes(1);
    });

    it('works for assistant role', () => {
      const repo = makeRepo();
      const session = makeSessionSvc();
      const svc = new MessageService(repo as any, session as any);

      svc.save({ role: 'assistant', content: 'response' });

      expect(repo.save.mock.calls[0][0].role).toBe('assistant');
    });
    it('calls session.ensureActiveSession before saving', () => {
      const repo = makeRepo();
      const session = makeSessionSvc();
      const svc = new MessageService(repo as any, session as any);

      svc.save({ role: 'user', content: 'msg' });

      expect(session.ensureActiveSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('getHistory', () => {
    it('calls session.ensureActiveSession before loading history', () => {
      const repo = makeRepo([]);
      const session = makeSessionSvc('sess-abc');
      const svc = new MessageService(repo as any, session as any);

      svc.getHistory();

      expect(session.ensureActiveSession).toHaveBeenCalledTimes(1);
    });

    it('returns messages from the repository for the session', () => {
      const fakeMessages = [{ id: 'm1' }, { id: 'm2' }];
      const repo = makeRepo(fakeMessages);
      const session = makeSessionSvc('sess-abc');
      const svc = new MessageService(repo as any, session as any);

      const history = svc.getHistory();

      expect(repo.getBySessionId).toHaveBeenCalledWith('sess-abc');
      expect(history).toEqual(fakeMessages);
    });

    it('returns empty array when no messages exist', () => {
      const repo = makeRepo([]);
      const svc = new MessageService(repo as any, makeSessionSvc() as any);
      expect(svc.getHistory()).toEqual([]);
    });

    it('uses the repository default limit', () => {
      const repo = makeRepo([]);
      const svc = new MessageService(repo as any, makeSessionSvc('sess-abc') as any);

      svc.getHistory();

      expect(repo.getBySessionId).toHaveBeenCalledWith('sess-abc');
    });
  });

  describe('getSessionMetadata', () => {
    it('returns the current session metadata', () => {
      const repo = makeRepo();
      const session = {
        getSession: vi.fn().mockReturnValue({ id: 'sess-1', metadata: { compactSummary: 'x' } }),
        ensureActiveSession: vi.fn(),
        updateCount: vi.fn(),
      };
      const svc = new MessageService(repo as any, session as any);

      expect(svc.getSessionMetadata()).toEqual({ compactSummary: 'x' });
    });
  });
});
