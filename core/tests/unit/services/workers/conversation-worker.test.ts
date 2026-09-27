import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationWorkerFactory } from '../../../../src/services/workers/conversation-worker';
import { MessageServiceFactory } from '../../../../src/services/message-service';
import type { ILogger } from '../../../../src/infrastructure/logger';

function makeLogger(): ILogger {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

function makeMessageService() {
  return { save: vi.fn(), getHistory: vi.fn(), getSessionId: vi.fn() };
}

function makeSessionManager() {
  return { getSessionService: vi.fn(), getSessionServiceById: vi.fn() };
}

function makeWorker(logger: ILogger, messageSvc = makeMessageService()) {
  vi.spyOn(MessageServiceFactory, 'create').mockReturnValue(messageSvc as never);
  const sessionManager = makeSessionManager();
  const worker = ConversationWorkerFactory.create(logger, {} as never, sessionManager as never);
  return { worker, messageSvc, sessionManager };
}

describe('ConversationWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves user message with correct role and content', async () => {
    const logger = makeLogger();
    const { worker, messageSvc } = makeWorker(logger);

    await worker.run({ sessionId: 's1', ask: 'hello', answer: 'hi', channel: 'tui' });

    expect(messageSvc.save).toHaveBeenCalledWith({ role: 'user', content: 'hello' });
  });

  it('saves assistant message with correct role and content', async () => {
    const logger = makeLogger();
    const { worker, messageSvc } = makeWorker(logger);

    await worker.run({ sessionId: 's1', ask: 'hello', answer: 'hi', channel: 'tui' });

    expect(messageSvc.save).toHaveBeenCalledWith({ role: 'assistant', content: 'hi' });
  });

  it('flags the assistant message with answerErrorCode when the turn failed', async () => {
    const logger = makeLogger();
    const { worker, messageSvc } = makeWorker(logger);

    await worker.run({ sessionId: 's1', ask: 'q', answer: 'Rate limit exceeded', answerErrorCode: 'rate_limited', channel: 'web' });

    expect(messageSvc.save).toHaveBeenCalledWith({ role: 'user', content: 'q' });
    expect(messageSvc.save).toHaveBeenCalledWith({ role: 'assistant', content: 'Rate limit exceeded', errorCode: 'rate_limited' });
  });

  it('calls save exactly twice (user + assistant)', async () => {
    const logger = makeLogger();
    const { worker, messageSvc } = makeWorker(logger);

    await worker.run({ sessionId: 's1', ask: 'q', answer: 'a', channel: 'web' });

    expect(messageSvc.save).toHaveBeenCalledTimes(2);
  });

  it('does not throw when save throws', async () => {
    const logger = makeLogger();
    const messageSvc = makeMessageService();
    messageSvc.save.mockImplementationOnce(() => { throw new Error('db error'); });
    const { worker } = makeWorker(logger, messageSvc);

    await expect(
      worker.run({ sessionId: 's1', ask: 'q', answer: 'a', channel: 'web' })
    ).resolves.toBeUndefined();
  });

  it('logs an error when save fails', async () => {
    const logger = makeLogger();
    const messageSvc = makeMessageService();
    messageSvc.save.mockImplementationOnce(() => { throw new Error('db error'); });
    const { worker } = makeWorker(logger, messageSvc);

    await worker.run({ sessionId: 's1', ask: 'q', answer: 'a', channel: 'web' });

    expect(logger.error).toHaveBeenCalled();
  });

  it('has name "conversationWorker"', () => {
    const { worker } = makeWorker(makeLogger());
    expect((worker as any).name).toBe('conversationWorker');
  });
});
