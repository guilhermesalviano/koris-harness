import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageGateway } from '../../../../src/services/agents/message-gateway';
import { AIServiceError } from '../../../../src/services/ai-completion-service';
import { config } from '../../../../src/config';
import { applyTestConfigDefaults } from '../../../helpers/test-config';
import type { ILogger } from '../../../../src/infrastructure/logger';
import { buildErrandService } from '../../../../src/services/errands';
import { Errand } from '../../../../src/entities/errand';

vi.mock('../../../../src/services/errands', () => ({ buildErrandService: vi.fn() }));

function makeLogger(): ILogger {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

function makeDeps() {
  const sessionService = {
    getSession: vi.fn().mockReturnValue({ id: 'session-1', metadata: {} }),
    forceRotate: vi.fn(),
    updateMetadata: vi.fn(),
  };
  const messageService = {
    getHistory: vi.fn().mockReturnValue([]),
    getSessionId: vi.fn().mockReturnValue('session-1'),
    getSessionMetadata: vi.fn().mockReturnValue({}),
    save: vi.fn(),
  };
  const memoryService = { upsert: vi.fn() };

  return {
    sessionContextFactory: {
      resolve: vi.fn().mockReturnValue({ sessionService, messageService, memoryService }),
    },
    backgroundDispatcher: {
      persistConversation: vi.fn(),
      summarizeConversation: vi.fn(),
      compactConversation: vi.fn().mockResolvedValue({ type: 'summary', content: 'we covered X' }),
    },
    mainAgent: { run: vi.fn().mockResolvedValue('assistant reply') },
    channelService: { record: vi.fn() },
    auditLogRepo: { findAll: vi.fn().mockReturnValue([]) },
    sessionService,
    messageService,
    memoryService,
  };
}

function makeGateway(channel = 'tui') {
  const logger = makeLogger();
  const deps = makeDeps();
  const db = {} as never;
  const sessionManager = {} as never;
  const negotiator = { run: vi.fn().mockResolvedValue({ reply: 'negotiator reply', applied: 'continue' }) };

  const gateway = new MessageGateway(
    logger,
    channel,
    db,
    sessionManager,
    deps.sessionContextFactory as never,
    deps.backgroundDispatcher as never,
    deps.mainAgent as never,
    deps.channelService as never,
    deps.auditLogRepo as never,
    negotiator as never,
  );

  return { gateway, logger, deps, negotiator };
}

describe('MessageGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyTestConfigDefaults();
    vi.mocked(buildErrandService).mockReturnValue({ findActiveForPeer: vi.fn().mockReturnValue(null), reopenForPeer: vi.fn().mockReturnValue(null), listByOrigin: vi.fn().mockReturnValue([]) } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles slash commands without calling the main agent', async () => {
    const { gateway, deps } = makeGateway();

    const result = await gateway.handle('/help', 'origin-1');

    expect(deps.mainAgent.run).not.toHaveBeenCalled();
    expect(result).toContain('/help');
    expect(deps.backgroundDispatcher.persistConversation).toHaveBeenCalledWith({
      sessionId: 'session-1',
      ask: '/help',
      answer: expect.stringContaining('/help'),
      channel: 'tui',
    });
    expect(deps.backgroundDispatcher.summarizeConversation).not.toHaveBeenCalled();
  });

  it('delegates regular messages to the main agent', async () => {
    const { gateway, deps } = makeGateway('web');

    const result = await gateway.handle('hello there', 'origin-1');

    expect(deps.mainAgent.run).toHaveBeenCalledWith({
      userMessage: 'hello there',
      channel: 'web',
      message: deps.messageService,
      images: undefined,
      stickers: undefined,
      target: 'origin-1',
      options: { runId: expect.any(String) },
    });
    expect(result).toBe('assistant reply');
  });

  it('passes process options through to the main agent', async () => {
    const { gateway, deps } = makeGateway();
    const onProgress = vi.fn();
    const controller = new AbortController();

    await gateway.handle('run task', 'origin-1', { onProgress, signal: controller.signal, toolsEnabled: true });

    expect(deps.mainAgent.run).toHaveBeenCalledWith({
      userMessage: 'run task',
      channel: 'tui',
      message: deps.messageService,
      images: undefined,
      stickers: undefined,
      target: 'origin-1',
      options: { onProgress, signal: controller.signal, toolsEnabled: true, runId: expect.any(String) },
    });
  });

  it('persists and summarizes after a main-agent response', async () => {
    const { gateway, deps } = makeGateway();

    await gateway.handle('question', 'origin-1');

    expect(deps.backgroundDispatcher.persistConversation).toHaveBeenCalledWith({
      sessionId: 'session-1',
      ask: 'question',
      answer: 'assistant reply',
      channel: 'tui',
    });
    expect(deps.backgroundDispatcher.summarizeConversation).toHaveBeenCalledWith({
      sessionId: 'session-1',
      ask: 'question',
      answer: 'assistant reply',
      channel: 'tui',
      memoryService: deps.memoryService,
    });
  });

  it('persists a failed provider turn (with error code) and rethrows', async () => {
    const { gateway, deps } = makeGateway('whatsapp');
    deps.mainAgent.run.mockRejectedValueOnce(new AIServiceError('rate_limited', 'Rate limit exceeded'));

    await expect(gateway.handle('question', 'origin-1')).rejects.toThrow('Rate limit exceeded');

    expect(deps.backgroundDispatcher.persistConversation).toHaveBeenCalledWith({
      sessionId: 'session-1',
      ask: 'question',
      answer: 'Rate limit exceeded',
      answerErrorCode: 'rate_limited',
      channel: 'whatsapp',
    });
    expect(deps.backgroundDispatcher.summarizeConversation).not.toHaveBeenCalled();
  });

  it('does not persist an aborted turn, but still rethrows', async () => {
    const { gateway, deps } = makeGateway('web');
    deps.mainAgent.run.mockRejectedValueOnce(new AIServiceError('aborted', 'Aborted'));

    await expect(gateway.handle('question', 'origin-1')).rejects.toThrow('Aborted');
    expect(deps.backgroundDispatcher.persistConversation).not.toHaveBeenCalled();
  });

  it('does not persist a non-provider error, but still rethrows', async () => {
    const { gateway, deps } = makeGateway();
    deps.mainAgent.run.mockRejectedValueOnce(new Error('boom'));

    await expect(gateway.handle('question', 'origin-1')).rejects.toThrow('boom');
    expect(deps.backgroundDispatcher.persistConversation).not.toHaveBeenCalled();
  });

  it('appends a domain-gate notice to a channel reply when a tool call was blocked', async () => {
    const { gateway, deps } = makeGateway('whatsapp');
    deps.auditLogRepo.findAll.mockReturnValue([
      {
        id: 'x', type: 'tool', role: 'worker', tool_calls: 0, duration_ms: 1, status: 'error',
        created_at: '2026-01-01T00:00:00Z', tool_name: 'curl_request',
        error_message: 'Domain gate: "api.evil.com" is not in allowed_domains. Add it to koris.json to allow this request. Allowed domains: .',
      },
    ]);

    const result = await gateway.handle('grab api.evil.com', 'origin-1', { toolsEnabled: true });

    expect(result).toContain('assistant reply');
    expect(result).toContain('/allow api.evil.com');
    expect(deps.backgroundDispatcher.persistConversation).toHaveBeenCalledWith(
      expect.objectContaining({ answer: expect.stringContaining('/allow api.evil.com') }),
    );
    // memory summary keeps the raw reply, without the plumbing notice
    expect(deps.backgroundDispatcher.summarizeConversation).toHaveBeenCalledWith(
      expect.objectContaining({ answer: 'assistant reply' }),
    );
  });

  it('does not append a domain-gate notice for the web channel (it has its own banner)', async () => {
    const { gateway, deps } = makeGateway('web');
    deps.auditLogRepo.findAll.mockReturnValue([
      {
        id: 'x', type: 'tool', role: 'worker', tool_calls: 0, duration_ms: 1, status: 'error',
        created_at: '2026-01-01T00:00:00Z', tool_name: 'curl_request',
        error_message: 'Domain gate: "api.evil.com" is not in allowed_domains.',
      },
    ]);

    const result = await gateway.handle('grab api.evil.com', 'origin-1', { toolsEnabled: true });

    expect(result).toBe('assistant reply');
  });

  it('persists under the current session id when the session rotates', async () => {
    const { gateway, deps } = makeGateway();
    deps.messageService.getSessionId.mockReturnValue('session-2');

    await gateway.handle('question', 'origin-1');

    expect(deps.backgroundDispatcher.persistConversation).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-2' }),
    );
  });

  it('resolves session context with the provided origin and session id', async () => {
    const { gateway, deps } = makeGateway();

    await gateway.handle('hello', 'origin-1', { sessionId: 'session-by-id' });

    expect(deps.sessionContextFactory.resolve).toHaveBeenCalledWith(
      { channel: 'tui', peerId: 'origin-1', kind: 'user' },
      'session-by-id',
    );
  });

  it('coerces non-string input before processing', async () => {
    const { gateway, deps } = makeGateway();

    await gateway.handle(null as unknown as string, 'origin-1');

    expect(deps.mainAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: '' }),
    );
  });

  it('forwards images to the main agent and persists them', async () => {
    const { gateway, deps } = makeGateway();
    const images = [{ data: 'aGVsbG8=', mimeType: 'image/png' }];

    await gateway.handle({ text: 'describe this', images }, 'origin-1');

    expect(deps.mainAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: 'describe this', images }),
    );
    expect(deps.backgroundDispatcher.persistConversation).toHaveBeenCalledWith(
      expect.objectContaining({ ask: 'describe this', askImages: images }),
    );
  });

  it('handles plain string input without images', async () => {
    const { gateway, deps } = makeGateway();

    await gateway.handle('hello', 'origin-1');

    expect(deps.mainAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: 'hello', images: undefined }),
    );
  });

  it('records the channel and origin target via the channel service', async () => {
    const { gateway, deps } = makeGateway('web');

    await gateway.handle('hello', 'origin-1', { channel: 'telegram' });

    expect(deps.channelService.record).toHaveBeenCalledWith('telegram', 'origin-1');
  });

  it('records the runtime channel when no channel option is provided', async () => {
    const { gateway, deps } = makeGateway('tui');

    await gateway.handle('hello', 'origin-1');

    expect(deps.channelService.record).toHaveBeenCalledWith('tui', 'origin-1');
  });

  it('uses the channel option, not the constructed runtime channel, for the main agent and persistence', async () => {
    const { gateway, deps } = makeGateway('web');

    await gateway.handle('hello', 'origin-1', { channel: 'whatsapp' });

    expect(deps.mainAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'whatsapp' }),
    );
    expect(deps.backgroundDispatcher.persistConversation).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'whatsapp' }),
    );
    expect(deps.backgroundDispatcher.summarizeConversation).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'whatsapp' }),
    );
  });

  describe('/compact', () => {
    it('compacts and rotates, never persists the /compact exchange, and seeds the fresh session with just the confirmation line', async () => {
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([{ role: 'user', content: 'hi' }] as never);
      deps.sessionService.forceRotate.mockReturnValue({ id: 'session-2' });
      deps.sessionService.getSession
        // One extra call up front: the command dispatcher reads the current
        // session id to attribute e.g. `/errand` to its origin session.
        .mockReturnValueOnce({ id: 'session-1' })
        .mockReturnValueOnce({ id: 'session-1' })
        .mockReturnValue({ id: 'session-2' });

      const result = await gateway.handle('/compact', 'origin-1');

      expect(deps.mainAgent.run).not.toHaveBeenCalled();
      expect(deps.backgroundDispatcher.compactConversation).toHaveBeenCalledWith({
        sessionId: 'session-1',
        messages: [{ role: 'user', content: 'hi' }],
        channel: 'tui',
        memoryService: deps.memoryService,
      });
      expect(deps.sessionService.forceRotate).toHaveBeenCalledWith('compact', { compactSummary: 'we covered X' });
      expect(deps.messageService.save).toHaveBeenCalledWith({
        role: 'assistant',
        content: 'Compacting session — starting a fresh one with a summary of what we covered.',
      });
      expect(deps.backgroundDispatcher.persistConversation).not.toHaveBeenCalled();
      expect(result).toContain('Compacting');
    });

    it('does nothing and skips rotation when there is no history to compact', async () => {
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([]);

      const result = await gateway.handle('/compact', 'origin-1');

      expect(deps.backgroundDispatcher.compactConversation).not.toHaveBeenCalled();
      expect(deps.sessionService.forceRotate).not.toHaveBeenCalled();
      expect(result).toBe('Nothing to compact yet.');
    });

    it('still rotates without a summary when compaction fails', async () => {
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([{ role: 'user', content: 'hi' }] as never);
      deps.backgroundDispatcher.compactConversation.mockResolvedValue(null);
      deps.sessionService.forceRotate.mockReturnValue({ id: 'session-2' });

      await gateway.handle('/compact', 'origin-1');

      expect(deps.sessionService.forceRotate).toHaveBeenCalledWith('compact', {});
      expect(deps.messageService.save).toHaveBeenCalledWith({
        role: 'assistant',
        content: 'Compacting session — starting a fresh one with a summary of what we covered.',
      });
    });

    it('notifies the caller of the rotated session id so a pinned client can follow it', async () => {
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([{ role: 'user', content: 'hi' }] as never);
      deps.sessionService.forceRotate.mockReturnValue({ id: 'session-2' });
      deps.sessionService.getSession
        .mockReturnValueOnce({ id: 'session-1' })
        .mockReturnValueOnce({ id: 'session-1' })
        .mockReturnValue({ id: 'session-2' });
      const onSessionRotated = vi.fn();

      await gateway.handle('/compact', 'origin-1', { onSessionRotated });

      expect(onSessionRotated).toHaveBeenCalledWith('session-2');
    });
  });

  describe('/clear', () => {
    it('rotates into a fresh empty session, notifies the caller, and persists under the old session', async () => {
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([{ role: 'user', content: 'hi' }] as never);
      deps.sessionService.forceRotate.mockReturnValue({ id: 'session-2' });
      deps.sessionService.getSession
        .mockReturnValueOnce({ id: 'session-1' })
        .mockReturnValueOnce({ id: 'session-1' })
        .mockReturnValue({ id: 'session-2' });
      const onSessionRotated = vi.fn();

      const result = await gateway.handle('/clear', 'origin-1', { onSessionRotated });

      expect(deps.mainAgent.run).not.toHaveBeenCalled();
      expect(deps.backgroundDispatcher.compactConversation).not.toHaveBeenCalled();
      expect(deps.sessionService.forceRotate).toHaveBeenCalledWith('clear', undefined);
      expect(onSessionRotated).toHaveBeenCalledWith('session-2');
      expect(deps.backgroundDispatcher.persistConversation).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1', ask: '/clear' }),
      );
      expect(result).toContain('fresh session');
    });

    it('is a no-op on an already-empty session', async () => {
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([]);

      const result = await gateway.handle('/clear', 'origin-1');

      expect(deps.sessionService.forceRotate).not.toHaveBeenCalled();
      expect(result).toBe('This session is already empty.');
    });

    it('carries responseMode forward when clearing a voice-mode session', async () => {
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([{ role: 'user', content: 'hi' }] as never);
      deps.sessionService.forceRotate.mockReturnValue({ id: 'session-2' });
      deps.sessionService.getSession.mockReturnValue({ id: 'session-1', metadata: { responseMode: 'voice' } });

      await gateway.handle('/clear', 'origin-1', { onSessionRotated: vi.fn() });

      expect(deps.sessionService.forceRotate).toHaveBeenCalledWith('clear', { responseMode: 'voice' });
    });
  });

  describe('/mode', () => {
    it('sets voice mode via updateMetadata without calling the main agent', async () => {
      const { gateway, deps } = makeGateway('whatsapp');

      const result = await gateway.handle('/mode voice', 'origin-1');

      expect(deps.mainAgent.run).not.toHaveBeenCalled();
      expect(deps.sessionService.updateMetadata).toHaveBeenCalledWith({ responseMode: 'voice' });
      expect(result).toContain('voice');
      expect(deps.backgroundDispatcher.persistConversation).toHaveBeenCalledWith(
        expect.objectContaining({ ask: '/mode voice', answer: expect.stringContaining('voice') }),
      );
    });

    it('reports the current mode when called with no argument', async () => {
      const { gateway, deps } = makeGateway('whatsapp');
      deps.sessionService.getSession.mockReturnValue({ id: 'session-1', metadata: { responseMode: 'voice' } });

      const result = await gateway.handle('/mode', 'origin-1');

      expect(deps.sessionService.updateMetadata).not.toHaveBeenCalled();
      expect(result).toContain('voice');
    });

    it('notes when text-to-speech is disabled in config', async () => {
      const { gateway } = makeGateway('whatsapp');
      config.AUDIO.TTS.ENABLED = false;

      const result = await gateway.handle('/mode voice', 'origin-1');

      expect(result).toContain('disabled');
    });
  });

  describe('/memory', () => {
    it('replies with the summary carried into the session', async () => {
      const { gateway, deps } = makeGateway();
      deps.messageService.getSessionMetadata.mockReturnValue({ compactSummary: 'we discussed the parser' });

      const result = await gateway.handle('/memory', 'origin-1');

      expect(deps.mainAgent.run).not.toHaveBeenCalled();
      expect(result).toContain('we discussed the parser');
      expect(deps.backgroundDispatcher.persistConversation).toHaveBeenCalledWith(
        expect.objectContaining({ ask: '/memory' }),
      );
    });

    it('says so when nothing has been compacted into the session', async () => {
      const { gateway, deps } = makeGateway();
      deps.messageService.getSessionMetadata.mockReturnValue({});

      const result = await gateway.handle('/memory', 'origin-1');

      expect(result).toContain("hasn't been compacted");
    });
  });

  describe('manual-mode auto-compact safety valve', () => {
    let originalNumCtx: number;
    let originalThreshold: number;

    beforeEach(() => {
      originalNumCtx = config.AI.MANAGER.NUM_CTX;
      originalThreshold = config.SESSION.COMPACT_THRESHOLD;
      Object.defineProperty(config.AI.MANAGER, 'NUM_CTX', { value: 20000, configurable: true, writable: true });
      Object.defineProperty(config.SESSION, 'COMPACT_THRESHOLD', { value: 0.9, configurable: true, writable: true });
    });

    afterEach(() => {
      Object.defineProperty(config.AI.MANAGER, 'NUM_CTX', { value: originalNumCtx, configurable: true, writable: true });
      Object.defineProperty(config.SESSION, 'COMPACT_THRESHOLD', { value: originalThreshold, configurable: true, writable: true });
    });

    it('proactively compacts before the turn when the session is near the context window', async () => {
      applyTestConfigDefaults({ summarizerMode: 'manual' });
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([{ role: 'user', content: 'x'.repeat(80000) }] as never);
      deps.sessionService.forceRotate.mockReturnValue({ id: 'session-2' });
      deps.sessionService.getSession
        .mockReturnValueOnce({ id: 'session-1' })
        .mockReturnValue({ id: 'session-2' });
      const onProgress = vi.fn();

      const result = await gateway.handle('hello', 'origin-1', { onProgress });

      expect(deps.backgroundDispatcher.compactConversation).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1' }),
      );
      expect(deps.sessionService.forceRotate).toHaveBeenCalledWith('compact', { compactSummary: 'we covered X' });
      expect(deps.mainAgent.run).toHaveBeenCalledTimes(1);
      expect(result).toBe('assistant reply');
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('summarized'));
    });

    it('does not proactively compact a small session', async () => {
      applyTestConfigDefaults({ summarizerMode: 'manual' });
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([{ role: 'user', content: 'short' }] as never);

      await gateway.handle('hello', 'origin-1');

      expect(deps.backgroundDispatcher.compactConversation).not.toHaveBeenCalled();
      expect(deps.mainAgent.run).toHaveBeenCalledTimes(1);
    });

    it('does not auto-compact in auto summarizer mode even when the context is huge', async () => {
      applyTestConfigDefaults({ summarizerMode: 'auto' });
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([{ role: 'user', content: 'x'.repeat(80000) }] as never);

      await gateway.handle('hello', 'origin-1');

      expect(deps.backgroundDispatcher.compactConversation).not.toHaveBeenCalled();
    });

    it('reactively compacts and retries once on a context_length error', async () => {
      applyTestConfigDefaults({ summarizerMode: 'manual' });
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([{ role: 'user', content: 'hi' }] as never);
      deps.sessionService.forceRotate.mockReturnValue({ id: 'session-2' });
      deps.sessionService.getSession
        .mockReturnValueOnce({ id: 'session-1' })
        .mockReturnValue({ id: 'session-2' });
      deps.mainAgent.run
        .mockRejectedValueOnce(new AIServiceError('context_length', "maximum context length is 20000 tokens"))
        .mockResolvedValueOnce('recovered reply');

      const result = await gateway.handle('hello', 'origin-1');

      expect(deps.mainAgent.run).toHaveBeenCalledTimes(2);
      expect(deps.backgroundDispatcher.compactConversation).toHaveBeenCalledTimes(1);
      expect(deps.backgroundDispatcher.compactConversation).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1' }),
      );
      expect(result).toBe('recovered reply');
    });

    it('retries only once, then rethrows a persistent context_length error', async () => {
      applyTestConfigDefaults({ summarizerMode: 'manual' });
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([{ role: 'user', content: 'hi' }] as never);
      deps.sessionService.forceRotate.mockReturnValue({ id: 'session-2' });
      deps.mainAgent.run.mockRejectedValue(new AIServiceError('context_length', 'context length exceeded'));

      await expect(gateway.handle('hello', 'origin-1')).rejects.toMatchObject({ code: 'context_length' });

      expect(deps.mainAgent.run).toHaveBeenCalledTimes(2);
      expect(deps.backgroundDispatcher.compactConversation).toHaveBeenCalledTimes(1);
    });

    it('does not compact on a context_length error in auto mode', async () => {
      applyTestConfigDefaults({ summarizerMode: 'auto' });
      const { gateway, deps } = makeGateway();
      deps.messageService.getHistory.mockReturnValue([{ role: 'user', content: 'hi' }] as never);
      deps.mainAgent.run.mockRejectedValueOnce(new AIServiceError('context_length', 'context length exceeded'));

      await expect(gateway.handle('hello', 'origin-1')).rejects.toMatchObject({ code: 'context_length' });

      expect(deps.backgroundDispatcher.compactConversation).not.toHaveBeenCalled();
      expect(deps.backgroundDispatcher.persistConversation).toHaveBeenCalledWith(
        expect.objectContaining({ answerErrorCode: 'context_length' }),
      );
    });
  });

  describe('errand routing', () => {
    it('a trusted sender without an active errand reaches their own user session', async () => {
      const { gateway, deps, negotiator } = makeGateway('whatsapp');

      await gateway.handle('hello', 'origin-1', { toolsEnabled: true, isTrustedSender: true });

      expect(buildErrandService).toHaveBeenCalled();
      expect(negotiator.run).not.toHaveBeenCalled();
      expect(deps.sessionContextFactory.resolve).toHaveBeenCalledWith(
        { channel: 'whatsapp', peerId: 'origin-1', kind: 'user' },
        undefined,
      );
      expect(deps.mainAgent.run).toHaveBeenCalledTimes(1);
    });

    it('tells a trusted turn about the chat\'s pending errand questions so a plain reply can answer them', async () => {
      const { gateway, deps } = makeGateway('whatsapp');
      const listByOrigin = vi.fn().mockReturnValue([
        new Errand({ id: 'e1', goal: 'Book a class', state: 'awaiting_principal', originSessionId: 'session-1', pendingMessage: 'Wednesday instead?' }),
        new Errand({ id: 'e2', goal: 'Old errand', state: 'resolved', originSessionId: 'session-1' }),
      ]);
      vi.mocked(buildErrandService).mockReturnValue({ findActiveForPeer: vi.fn().mockReturnValue(null), reopenForPeer: vi.fn().mockReturnValue(null), listByOrigin } as never);

      await gateway.handle('sim', 'origin-1', { toolsEnabled: true, isTrustedSender: true });

      expect(listByOrigin).toHaveBeenCalledWith('session-1');
      const [block] = deps.mainAgent.run.mock.calls[0][0].options.skillBlocks;
      expect(block).toContain('# Errands In This Chat');
      expect(block).toContain('[e1] waiting on the human\'s answer — Book a class');
      expect(block).toContain('Pending question: Wednesday instead?');
      expect(block).not.toContain('Old errand');
    });

    it('keeps pending questions out of a web Orchestrator turn, since they are answered on the Negotiator page', async () => {
      const { gateway, deps } = makeGateway('web');
      const listByOrigin = vi.fn().mockReturnValue([
        new Errand({ id: 'e1', goal: 'Book a class', state: 'awaiting_principal', originSessionId: 'session-1', pendingMessage: 'Wednesday instead?' }),
        new Errand({ id: 'e2', goal: 'Buy milk', state: 'draft', originSessionId: 'session-1', pendingMessage: 'Hi!' }),
      ]);
      vi.mocked(buildErrandService).mockReturnValue({ findActiveForPeer: vi.fn().mockReturnValue(null), reopenForPeer: vi.fn().mockReturnValue(null), listByOrigin } as never);

      await gateway.handle('sim', 'web', { toolsEnabled: true });

      const [block] = deps.mainAgent.run.mock.calls[0][0].options.skillBlocks;
      expect(block).toContain('Draft opener: Hi!');
      expect(block).not.toContain('Wednesday instead?');
    });

    it('adds no errand block without open errands or without tools', async () => {
      const { gateway, deps } = makeGateway('whatsapp');
      await gateway.handle('hello', 'origin-1', { toolsEnabled: true, isTrustedSender: true });
      expect(deps.mainAgent.run.mock.calls[0][0].options.skillBlocks).toBeUndefined();

      const listByOrigin = vi.fn().mockReturnValue([new Errand({ id: 'e1', goal: 'Book', state: 'awaiting_principal', originSessionId: 'session-1' })]);
      vi.mocked(buildErrandService).mockReturnValue({ findActiveForPeer: vi.fn().mockReturnValue(null), reopenForPeer: vi.fn().mockReturnValue(null), listByOrigin } as never);
      await gateway.handle('hello', 'origin-1', { toolsEnabled: false, isTrustedSender: false });
      expect(listByOrigin).not.toHaveBeenCalled();
      expect(deps.mainAgent.run.mock.calls[1][0].options.skillBlocks).toBeUndefined();
    });

    it('an untrusted sender with no active errand gets today\'s behaviour: routed to the user session, tools disabled by the caller', async () => {
      const { gateway, deps, negotiator } = makeGateway('whatsapp');

      await gateway.handle('hello', 'origin-1', { toolsEnabled: false, isTrustedSender: false });

      expect(negotiator.run).not.toHaveBeenCalled();
      expect(deps.sessionContextFactory.resolve).toHaveBeenCalledWith(
        { channel: 'whatsapp', peerId: 'origin-1', kind: 'user' },
        undefined,
      );
      expect(deps.mainAgent.run).toHaveBeenCalledTimes(1);
    });

    it('an untrusted contact of a recently resolved errand reopens it, is recorded in its contact session and gets no reply', async () => {
      const { gateway, deps, negotiator } = makeGateway('whatsapp');
      const reopenForPeer = vi.fn().mockReturnValue({ errand: { id: 'errand-1' }, sessionId: 'delegated-session' });
      vi.mocked(buildErrandService).mockReturnValue({ findActiveForPeer: vi.fn().mockReturnValue(null), reopenForPeer } as never);

      const result = await gateway.handle('Can I add a drink?', 'origin-1', { isTrustedSender: false, peerAliases: ['555@s.whatsapp.net'] });

      expect(reopenForPeer).toHaveBeenCalledWith('whatsapp', 'origin-1', 'Can I add a drink?', ['555@s.whatsapp.net']);
      expect(deps.sessionContextFactory.resolve).toHaveBeenCalledWith({ channel: 'whatsapp', peerId: 'origin-1', kind: 'delegated' }, 'delegated-session');
      expect(deps.messageService.save).toHaveBeenCalledExactlyOnceWith({ role: 'user', content: 'Can I add a drink?', images: undefined });
      expect(result).toBe('');
      expect(negotiator.run).not.toHaveBeenCalled();
      expect(deps.mainAgent.run).not.toHaveBeenCalled();
    });

    it('hands the contact\'s images to the negotiator and keeps them in the contact session', async () => {
      const { gateway, deps, negotiator } = makeGateway('whatsapp');
      vi.mocked(buildErrandService).mockReturnValue({
        findActiveForPeer: vi.fn().mockReturnValue({ errand: { id: 'errand-1' }, sessionId: 'delegated-session' }),
      } as never);
      const images = [{ data: 'bWVudQ==', mimeType: 'image/jpeg' }];

      await gateway.handle({ text: 'Segue o cardápio', images }, 'origin-1', { isTrustedSender: false });

      expect(deps.messageService.save).toHaveBeenCalledWith({ role: 'user', content: 'Segue o cardápio', images });
      expect(negotiator.run).toHaveBeenCalledWith(expect.objectContaining({ peerMessage: 'Segue o cardápio', peerImages: images }));
    });

    it('a trusted sender never reopens a resolved errand', async () => {
      const { gateway, deps } = makeGateway('whatsapp');
      const reopenForPeer = vi.fn();
      vi.mocked(buildErrandService).mockReturnValue({ findActiveForPeer: vi.fn().mockReturnValue(null), reopenForPeer, listByOrigin: vi.fn().mockReturnValue([]) } as never);

      await gateway.handle('hello', 'origin-1', { isTrustedSender: true });

      expect(reopenForPeer).not.toHaveBeenCalled();
      expect(deps.mainAgent.run).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('a contact with trust=%s and an active errand uses the matched delegated session', async (isTrustedSender) => {
      const { gateway, deps, negotiator } = makeGateway('whatsapp');
      vi.mocked(buildErrandService).mockReturnValue({
        findActiveForPeer: vi.fn().mockReturnValue({ errand: { id: 'errand-1' }, sessionId: 'delegated-session' }),
      } as never);

      const result = await gateway.handle('what is the status?', 'origin-1', { isTrustedSender });

      expect(deps.sessionContextFactory.resolve).toHaveBeenCalledWith(
        { channel: 'whatsapp', peerId: 'origin-1', kind: 'delegated' },
        'delegated-session',
      );
      expect(negotiator.run).toHaveBeenCalledWith({
        errandId: 'errand-1',
        sessionId: 'session-1',
        channel: 'whatsapp',
        peerMessage: 'what is the status?',
        messageHistory: [],
      });
      expect(result).toBe('negotiator reply');
      expect(deps.mainAgent.run).not.toHaveBeenCalled();
    });

    it('looks the errand up by the contact\'s other channel addresses too', async () => {
      const { gateway } = makeGateway('whatsapp');
      const findActiveForPeer = vi.fn().mockReturnValue(null);
      vi.mocked(buildErrandService).mockReturnValue({ findActiveForPeer, reopenForPeer: vi.fn().mockReturnValue(null) } as never);

      await gateway.handle('hello', '141789856067723@lid', { isTrustedSender: false, peerAliases: ['555@s.whatsapp.net'] });

      expect(findActiveForPeer).toHaveBeenCalledWith('whatsapp', '141789856067723@lid', ['555@s.whatsapp.net']);
    });

    it('a trusted contact can still run commands in their own user session', async () => {
      const { gateway, deps, negotiator } = makeGateway('whatsapp');
      vi.mocked(buildErrandService).mockReturnValue({
        findActiveForPeer: vi.fn().mockReturnValue({ errand: { id: 'errand-1' }, sessionId: 'delegated-session' }),
      } as never);
      await gateway.handle('/help', 'origin-1', { isTrustedSender: true, toolsEnabled: true });
      expect(buildErrandService).not.toHaveBeenCalled();
      expect(negotiator.run).not.toHaveBeenCalled();
      expect(deps.sessionContextFactory.resolve).toHaveBeenCalledWith({ channel: 'whatsapp', peerId: 'origin-1', kind: 'user' }, undefined);
    });

    it('never dispatches a command, and never calls the main agent, for a delegated turn', async () => {
      const { gateway, deps } = makeGateway('whatsapp');
      vi.mocked(buildErrandService).mockReturnValue({
        findActiveForPeer: vi.fn().mockReturnValue({ errand: { id: 'errand-1' }, sessionId: 'delegated-session' }),
      } as never);

      await gateway.handle('/clear', 'origin-1', { isTrustedSender: false });

      expect(deps.mainAgent.run).not.toHaveBeenCalled();
      expect(deps.sessionService.forceRotate).not.toHaveBeenCalled();
    });

    it('persists the delegated turn into the same (delegated) session transcript', async () => {
      const { gateway, deps } = makeGateway('whatsapp');
      vi.mocked(buildErrandService).mockReturnValue({
        findActiveForPeer: vi.fn().mockReturnValue({ errand: { id: 'errand-1' }, sessionId: 'delegated-session' }),
      } as never);

      await gateway.handle('hello', 'origin-1', { isTrustedSender: false });

      expect(deps.messageService.save).toHaveBeenNthCalledWith(1, { role: 'user', content: 'hello', images: undefined });
      expect(deps.messageService.save).toHaveBeenNthCalledWith(2, { role: 'assistant', content: 'negotiator reply' });
      expect(deps.backgroundDispatcher.persistConversation).not.toHaveBeenCalled();
    });

    it('processes consecutive contact messages only after the preceding exchange is persisted', async () => {
      const { gateway, deps, negotiator } = makeGateway('whatsapp');
      vi.mocked(buildErrandService).mockReturnValue({
        findActiveForPeer: vi.fn().mockReturnValue({ errand: { id: 'errand-1' }, sessionId: 'delegated-session' }),
      } as never);
      let release!: () => void;
      const history: { role: string; content: string }[] = [];
      deps.messageService.getHistory.mockImplementation(() => [...history]);
      deps.messageService.save.mockImplementation((message) => { history.push(message); });
      negotiator.run.mockImplementationOnce(() => new Promise((resolve) => {
        release = () => resolve({ reply: 'What other hours are available?', applied: 'continue' });
      }));
      const first = gateway.handle('10 is unavailable', 'origin-1', { isTrustedSender: false });
      const second = gateway.handle('11 or 14', 'origin-1', { isTrustedSender: false });
      await vi.waitFor(() => expect(negotiator.run).toHaveBeenCalledTimes(1));
      expect(history).toEqual([expect.objectContaining({ role: 'user', content: '10 is unavailable' })]);
      expect(negotiator.run).toHaveBeenNthCalledWith(1, expect.objectContaining({ messageHistory: [] }));
      release();
      await Promise.all([first, second]);
      expect(negotiator.run).toHaveBeenNthCalledWith(2, expect.objectContaining({
        peerMessage: '11 or 14',
        messageHistory: [
          expect.objectContaining({ role: 'user', content: '10 is unavailable' }),
          { role: 'assistant', content: 'What other hours are available?' },
        ],
      }));
    });
  });
});
