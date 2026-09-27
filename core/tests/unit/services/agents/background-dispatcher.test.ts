import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackgroundDispatcher } from '../../../../src/services/agents/background-dispatcher';
import { applyTestConfigDefaults } from '../../../helpers/test-config';
import type { ILogger } from '../../../../src/infrastructure/logger';

function makeLogger(): ILogger {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

function makeDispatcher(overrides: {
  conversationRun?: ReturnType<typeof vi.fn>;
  summarizerHandler?: ReturnType<typeof vi.fn>;
  compact?: ReturnType<typeof vi.fn>;
} = {}) {
  const logger = makeLogger();
  const conversationWorker = {
    run: overrides.conversationRun ?? vi.fn().mockResolvedValue(undefined),
  };
  const summarizerWorker = {
    handler: overrides.summarizerHandler ?? vi.fn().mockResolvedValue(undefined),
    compact: overrides.compact ?? vi.fn().mockResolvedValue({ type: 'summary', content: 'a summary' }),
  };

  const dispatcher = new BackgroundDispatcher(
    logger,
    conversationWorker as never,
    summarizerWorker as never,
  );

  return { dispatcher, logger, conversationWorker, summarizerWorker };
}

const persistProps = { sessionId: 'session-1', ask: 'hi', answer: 'hello', channel: 'tui' };

describe('BackgroundDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyTestConfigDefaults();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists the conversation through the conversation worker', () => {
    const { dispatcher, conversationWorker } = makeDispatcher();

    dispatcher.persistConversation(persistProps);

    expect(conversationWorker.run).toHaveBeenCalledWith(persistProps);
  });

  it('logs when conversation persistence fails', async () => {
    const { dispatcher, logger } = makeDispatcher({
      conversationRun: vi.fn().mockRejectedValue(new Error('db down')),
    });

    dispatcher.persistConversation(persistProps);
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        'Background conversation processing failed',
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });
  });

  it('summarizes the conversation when the summarizer is enabled', () => {
    applyTestConfigDefaults({ summarizerMode: 'auto' });
    const { dispatcher, summarizerWorker } = makeDispatcher();
    const memoryService = { upsert: vi.fn() };

    dispatcher.summarizeConversation({ ...persistProps, memoryService: memoryService as never });

    expect(summarizerWorker.handler).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', memoryService }),
    );
  });

  it('does not summarize when the summarizer is disabled', () => {
    applyTestConfigDefaults({ summarizerMode: 'manual' });
    const { dispatcher, summarizerWorker } = makeDispatcher();

    dispatcher.summarizeConversation({ ...persistProps, memoryService: { upsert: vi.fn() } as never });

    expect(summarizerWorker.handler).not.toHaveBeenCalled();
  });

  it('does not summarize a failed provider turn', () => {
    applyTestConfigDefaults({ summarizerMode: 'auto' });
    const { dispatcher, summarizerWorker } = makeDispatcher();

    dispatcher.summarizeConversation({ ...persistProps, answerErrorCode: 'unavailable', memoryService: { upsert: vi.fn() } as never });

    expect(summarizerWorker.handler).not.toHaveBeenCalled();
  });

  it('does not summarize when the agent response is empty', () => {
    applyTestConfigDefaults({ summarizerMode: 'auto' });
    const { dispatcher, summarizerWorker } = makeDispatcher();

    dispatcher.summarizeConversation({ ...persistProps, answer: '   ', memoryService: { upsert: vi.fn() } as never });

    expect(summarizerWorker.handler).not.toHaveBeenCalled();
  });

  it('logs when summarization fails', async () => {
    applyTestConfigDefaults({ summarizerMode: 'auto' });
    const { dispatcher, logger } = makeDispatcher({
      summarizerHandler: vi.fn().mockRejectedValue(new Error('summarizer down')),
    });

    dispatcher.summarizeConversation({ ...persistProps, memoryService: { upsert: vi.fn() } as never });
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        'Background summarizer failed',
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });
  });

  describe('compactConversation', () => {
    const compactProps = { sessionId: 'session-1', messages: [{ role: 'user', content: 'hi' }] as never, channel: 'tui', memoryService: { save: vi.fn() } as never };

    it('returns the compacted result from the summarizer', async () => {
      const { dispatcher, summarizerWorker } = makeDispatcher();

      const result = await dispatcher.compactConversation(compactProps);

      expect(summarizerWorker.compact).toHaveBeenCalledWith(compactProps);
      expect(result).toEqual({ type: 'summary', content: 'a summary' });
    });

    it('returns null without calling the summarizer when there is no history', async () => {
      const { dispatcher, summarizerWorker } = makeDispatcher();

      const result = await dispatcher.compactConversation({ ...compactProps, messages: [] as never });

      expect(summarizerWorker.compact).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('returns null and logs when compaction fails', async () => {
      const { dispatcher, logger } = makeDispatcher({
        compact: vi.fn().mockRejectedValue(new Error('compaction down')),
      });

      const result = await dispatcher.compactConversation(compactProps);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Compaction failed',
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });
  });
});
