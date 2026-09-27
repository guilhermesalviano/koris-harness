import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Summarizer } from '../../../../../../src/services/agents/sub-agents/summarizer/sub-agent';
import { SUMMARIZATION_INSTRUCTIONS, COMPACT_INSTRUCTIONS } from '../../../../../../src/constants';
import type { ILogger } from '../../../../../../src/infrastructure/logger';
import * as providerRegistry from '../../../../../../src/services/providers';
import { config } from '../../../../../../src/config';
import { sharedSubAgentQueue } from '../../../../../../src/services/agents/sub-agents/queue/task-queue';

function makeLogger(): ILogger {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

function makeAuditService() {
  return { record: vi.fn() };
}

function makeProps(overrides: Partial<{
  sessionId: string;
  ask: string;
  answer: string;
  channel: string;
  memoryService: { save: ReturnType<typeof vi.fn> };
}> = {}) {
  return {
    sessionId: 'session-1',
    ask: 'What is TypeScript?',
    answer: 'TypeScript is a typed superset of JavaScript.',
    channel: 'tui',
    memoryService: { save: vi.fn() },
    ...overrides,
  };
}

describe('Summarizer', () => {
  const originalEmbeddingEnabled = config.AI.EMBED.ENABLED;

  beforeEach(() => {
    (config.AI.EMBED as { ENABLED: boolean }).ENABLED = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    (config.AI.EMBED as { ENABLED: boolean }).ENABLED = originalEmbeddingEnabled;
  });

  it('stores parsed memory type and content from AI JSON', async () => {
    vi.spyOn(providerRegistry, 'getAIProvider').mockReturnValue({
      embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    } as any);

    const logger = makeLogger();
    const completionService = {
      complete: vi.fn().mockResolvedValue({
        kind: 'message',
        text: '{"type":"fact","content":"TS adds static typing."}',
      }),
    };
    const summarizer = new Summarizer(logger, completionService as never, makeAuditService());
    const props = makeProps();

    await summarizer.handler(props);

    expect(completionService.complete).toHaveBeenCalledWith(
      {
        messages: [
          { role: 'system', content: SUMMARIZATION_INSTRUCTIONS },
          { role: 'user', content: expect.stringContaining('What is TypeScript?') },
        ],
      },
      { audit: { sessionId: 'session-1', channel: 'tui' } },
    );
    expect(props.memoryService.save).toHaveBeenCalledWith({
      type: 'fact',
      content: 'TS adds static typing.',
      embedding: [0.1, 0.2],
    });
    expect(providerRegistry.getAIProvider).toHaveBeenCalledWith(expect.anything(), 'embed', expect.objectContaining({ background: true }));
    expect(logger.info).toHaveBeenCalledWith('Summarizer worker completed for session session-1');
  });

  it('defaults to summary when AI returns plain text', async () => {
    vi.spyOn(providerRegistry, 'getAIProvider').mockReturnValue({
      embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    } as any);

    const logger = makeLogger();
    const completionService = {
      complete: vi.fn().mockResolvedValue({ kind: 'message', text: 'TS adds static typing.' }),
    };
    const summarizer = new Summarizer(logger, completionService as never, makeAuditService());
    const props = makeProps();

    await summarizer.handler(props);

    expect(props.memoryService.save).toHaveBeenCalledWith({
      type: 'summary',
      content: 'TS adds static typing.',
      embedding: [0.1, 0.2],
    });
  });

  it('skips embedding generation when embeddings are disabled', async () => {
    const embed = vi.fn().mockResolvedValue([0.1, 0.2]);
    vi.spyOn(providerRegistry, 'getAIProvider').mockReturnValue({ embed } as any);
    (config.AI.EMBED as { ENABLED: boolean }).ENABLED = false;

    const logger = makeLogger();
    const completionService = {
      complete: vi.fn().mockResolvedValue({
        kind: 'message',
        text: '{"type":"fact","content":"TS adds static typing."}',
      }),
    };
    const summarizer = new Summarizer(logger, completionService as never, makeAuditService());
    const props = makeProps();

    await summarizer.handler(props);

    expect(embed).not.toHaveBeenCalled();
    expect(props.memoryService.save).toHaveBeenCalledWith({
      type: 'fact',
      content: 'TS adds static typing.',
      embedding: undefined,
    });
    expect(logger.info).toHaveBeenCalledWith('Summarizer worker completed for session session-1');
  });

  it('skips summarization without saving memory when the model returns tool calls', async () => {
    const logger = makeLogger();
    const completionService = {
      complete: vi.fn().mockResolvedValue({
        kind: 'tool_calls',
        calls: [{ name: 'noop', arguments: {} }],
      }),
    };
    const summarizer = new Summarizer(logger, completionService as never, makeAuditService());
    const props = makeProps();

    await summarizer.handler(props);

    expect(props.memoryService.save).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Summarizer received an unexpected tool-call response; skipping summarization',
      expect.objectContaining({ sessionId: 'session-1' }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

it('logs an error when completion fails', async () => {
    const logger = makeLogger();
    const auditService = makeAuditService();
    const completionService = {
      complete: vi.fn().mockRejectedValue(new Error('provider offline')),
    };
    const summarizer = new Summarizer(logger, completionService as never, auditService);
    const props = makeProps();

    await summarizer.handler(props);

    expect(props.memoryService.save).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to summarize for session session-1',
      expect.objectContaining({ error: expect.any(Error) }),
    );
    const entry = auditService.record.mock.calls[0][0];
    expect(entry).toMatchObject({
      type: 'llm',
      role: 'worker',
      agentName: 'summarizer',
      sessionId: 'session-1',
      channel: 'tui',
      status: 'error',
      errorMessage: 'provider offline',
    });
  });

  it('records a downstream error in the audit log', async () => {
    const logger = makeLogger();
    const auditService = makeAuditService();
    const completionService = {
      complete: vi.fn().mockResolvedValue({
        kind: 'message',
        text: '{"type":"fact","content":"TS adds static typing."}',
      }),
    };
    const summarizer = new Summarizer(logger, completionService as never, auditService);
    const props = makeProps({
      memoryService: { save: vi.fn().mockImplementation(() => { throw new Error('db full'); }) },
    });

    await summarizer.handler(props);

    expect(auditService.record).toHaveBeenCalledTimes(1);
    const entry = auditService.record.mock.calls[0][0];
    expect(entry).toMatchObject({
      type: 'llm',
      agentName: 'summarizer',
      status: 'error',
      sessionId: 'session-1',
      errorMessage: 'db full',
    });
  });

  it('queues concurrent runs so they execute serially when subagents_parallel is false', async () => {
    (config.AI as { SUBAGENTS_PARALLEL: boolean }).SUBAGENTS_PARALLEL = true;
    const release: Array<() => void> = [];
    const gated = () => new Promise<unknown>((resolve) => release.push(() => resolve({ kind: 'message', text: '{"type":"fact","content":"queued"}' })));

    const logger = makeLogger();
    const completionService = {
      complete: vi.fn().mockImplementation(gated),
    };
    const summarizer = new Summarizer(logger, completionService as never, makeAuditService());
    const propsA = makeProps({ sessionId: 'session-a' });
    const propsB = makeProps({ sessionId: 'session-b' });

    const first = summarizer.handler(propsA);
    const second = summarizer.handler(propsB);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completionService.complete).toHaveBeenCalledTimes(1);

    release[0]();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completionService.complete).toHaveBeenCalledTimes(2);

    release[1]();
    await second;

    expect(propsA.memoryService.save).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'queued' }),
    );
    expect(propsB.memoryService.save).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'queued' }),
    );
  });

  it('uses the shared sub-agent queue when subagents_parallel is false', async () => {
    (config.AI as { SUBAGENTS_PARALLEL: boolean }).SUBAGENTS_PARALLEL = false;
    const logger = makeLogger();
    const summarizer = new Summarizer(logger, { complete: vi.fn() } as never, makeAuditService());

    expect((summarizer as unknown as { queue: unknown }).queue).toBe(sharedSubAgentQueue);
  });

  it('uses its own queue when subagents_parallel is true', async () => {
    (config.AI as { SUBAGENTS_PARALLEL: boolean }).SUBAGENTS_PARALLEL = true;
    const logger = makeLogger();
    const summarizer = new Summarizer(logger, { complete: vi.fn() } as never, makeAuditService());

    expect((summarizer as unknown as { queue: unknown }).queue).not.toBe(sharedSubAgentQueue);
  });

  it('exposes queue state via snapshot', async () => {
    (config.AI as { SUBAGENTS_PARALLEL: boolean }).SUBAGENTS_PARALLEL = true;
    const originalEmbeddingEnabled = config.AI.EMBED.ENABLED;
    (config.AI.EMBED as { ENABLED: boolean }).ENABLED = false;

    const release: Array<() => void> = [];
    const gated = () => new Promise<unknown>((resolve) => release.push(() => resolve({ kind: 'message', text: '{"type":"fact","content":"x"}' })));
    const summarizer = new Summarizer(makeLogger(), { complete: vi.fn().mockImplementation(gated) } as never, makeAuditService());

    const first = summarizer.handler(makeProps({ sessionId: 'session-a' }));
    const second = summarizer.handler(makeProps({ sessionId: 'session-b' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const queue = (summarizer as unknown as { queue: { snapshot(): unknown } }).queue;
    expect(queue.snapshot()).toEqual({ queued: 1, active: 1, concurrency: 1, queuedLabels: ['summarizer'], activeLabels: ['summarizer'] });

    release[0]();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    release[1]();
    await second;

    expect(queue.snapshot()).toEqual({ queued: 0, active: 0, concurrency: 1, queuedLabels: [], activeLabels: [] });

    (config.AI.EMBED as { ENABLED: boolean }).ENABLED = originalEmbeddingEnabled;
  });

  describe('compact', () => {
    function makeCompactProps(overrides: Partial<{
      sessionId: string;
      messages: Array<{ role: string; content: string }>;
      channel: string;
      memoryService: { save: ReturnType<typeof vi.fn> };
    }> = {}) {
      return {
        sessionId: 'session-1',
        messages: [
          { role: 'user', content: 'Help me plan a trip.' },
          { role: 'assistant', content: 'Sure, where to?' },
        ],
        channel: 'tui',
        memoryService: { save: vi.fn() },
        ...overrides,
      } as never;
    }

    it('summarizes the full transcript and saves the parsed memory', async () => {
      vi.spyOn(providerRegistry, 'getAIProvider').mockReturnValue({
        embed: vi.fn().mockResolvedValue([0.3]),
      } as any);
      (config.AI.EMBED as { ENABLED: boolean }).ENABLED = true;

      const logger = makeLogger();
      const completionService = {
        complete: vi.fn().mockResolvedValue({
          kind: 'message',
          text: '{"type":"summary","content":"Planned a trip together."}',
        }),
      };
      const summarizer = new Summarizer(logger, completionService as never, makeAuditService());
      const props = makeCompactProps();

      const result = await summarizer.compact(props);

      expect(completionService.complete).toHaveBeenCalledWith(
        {
          messages: [
            { role: 'system', content: COMPACT_INSTRUCTIONS },
            { role: 'user', content: expect.stringContaining('Help me plan a trip.') },
          ],
        },
        { audit: { sessionId: 'session-1', channel: 'tui' } },
      );
      expect(props.memoryService.save).toHaveBeenCalledWith({
        type: 'summary',
        content: 'Planned a trip together.',
        embedding: [0.3],
      });
      expect(result).toEqual({ type: 'summary', content: 'Planned a trip together.' });
    });

    it('throws and records an audit entry when completion fails', async () => {
      const logger = makeLogger();
      const auditService = makeAuditService();
      const completionService = {
        complete: vi.fn().mockRejectedValue(new Error('provider offline')),
      };
      const summarizer = new Summarizer(logger, completionService as never, auditService);
      const props = makeCompactProps();

      await expect(summarizer.compact(props)).rejects.toThrow('provider offline');

      expect(props.memoryService.save).not.toHaveBeenCalled();
      const entry = auditService.record.mock.calls[0][0];
      expect(entry).toMatchObject({
        agentName: 'summarizer',
        sessionId: 'session-1',
        channel: 'tui',
        status: 'error',
        errorMessage: 'provider offline',
      });
    });

    it('throws when the model returns tool calls instead of a message', async () => {
      const logger = makeLogger();
      const completionService = {
        complete: vi.fn().mockResolvedValue({ kind: 'tool_calls', calls: [] }),
      };
      const summarizer = new Summarizer(logger, completionService as never, makeAuditService());
      const props = makeCompactProps();

      await expect(summarizer.compact(props)).rejects.toThrow();
      expect(props.memoryService.save).not.toHaveBeenCalled();
    });
  });
});
