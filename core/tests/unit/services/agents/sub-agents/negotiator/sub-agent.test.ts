import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Negotiator } from '../../../../../../src/services/agents/sub-agents/negotiator/sub-agent';
import { buildErrandService } from '../../../../../../src/services/errands';
import { NEGOTIATOR_IMAGE_INSTRUCTION, THIRD_PARTY_CONVERSATION_CONTEXT } from '../../../../../../src/constants';

vi.mock('../../../../../../src/services/errands', () => ({ buildErrandService: vi.fn() }));

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeErrandService(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn().mockReturnValue({ id: 'errand-1', state: 'awaiting_peer', goal: 'buy milk', notes: 'previous notes' }),
    recordPeerReply: vi.fn(),
    escalate: vi.fn(),
    resolve: vi.fn(),
    proposeResolution: vi.fn().mockReturnValue({ state: 'awaiting_confirmation' }),
    fail: vi.fn(),
    ...overrides,
  };
}

function makeCompletionService(text: string) {
  return { complete: vi.fn().mockResolvedValue({ kind: 'message', text }) };
}

function makePromptRepository() {
  return { build: vi.fn().mockResolvedValue({ messages: [], tools: undefined }) };
}

function makeSessionManager(instructions = THIRD_PARTY_CONVERSATION_CONTEXT) {
  return { getSessionServiceById: vi.fn(() => ({ getSession: () => ({ metadata: { instructions } }) })) };
}

function makeNegotiator(opts: { errandService?: ReturnType<typeof makeErrandService>; completionText?: string } = {}) {
  const errandService = opts.errandService ?? makeErrandService();
  vi.mocked(buildErrandService).mockReturnValue(errandService as never);

  const completionService = makeCompletionService(opts.completionText ?? JSON.stringify({ action: 'continue', reply: 'sure' }));
  const promptRepository = makePromptRepository();
  const logger = makeLogger();

  const sessionManager = makeSessionManager();
  const negotiator = new Negotiator(logger, {} as never, sessionManager as never, completionService as never, promptRepository as never);

  return { negotiator, errandService, completionService, promptRepository, logger, sessionManager };
}

describe('Negotiator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets the negotiator see the images the contact sent, with its own image instruction', async () => {
    const { negotiator, promptRepository } = makeNegotiator();
    const images = [{ data: 'bWVudQ==', mimeType: 'image/jpeg' }];

    await negotiator.run({ errandId: 'errand-1', sessionId: 'session-1', channel: 'whatsapp', peerMessage: 'Segue o cardápio', peerImages: images, messageHistory: [] });

    expect(promptRepository.build).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: 'Segue o cardápio', images, imageInstruction: NEGOTIATOR_IMAGE_INSTRUCTION,
    }));
    expect(NEGOTIATOR_IMAGE_INSTRUCTION).toContain('Your output format does not change.');
  });

  it('builds the prompt with no tools, no learned skills, and no memory', async () => {
    const { negotiator, promptRepository } = makeNegotiator();

    await negotiator.run({
      errandId: 'errand-1',
      sessionId: 'session-1',
      channel: 'whatsapp',
      peerMessage: 'is this still available?',
      messageHistory: [],
    });

    expect(promptRepository.build).toHaveBeenCalledWith(expect.objectContaining({
      toolsEnabled: false,
      learnedSkillsEnabled: false,
      includeMemory: false,
      systemPrompt: '',
      includeGlobalContext: false,
      historyLimit: 100,
      userMessage: 'is this still available?',
      channel: 'whatsapp',
      sessionId: 'session-1',
    }));
  });

  it('includes the errand goal and notes in the extra system blocks', async () => {
    const { negotiator, promptRepository } = makeNegotiator();

    await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'hi', messageHistory: [] });

    const [call] = promptRepository.build.mock.calls[0];
    expect(call.extraSystemBlocks.join('\n')).toContain('buy milk');
    expect(call.extraSystemBlocks.join('\n')).toContain('previous notes');
  });

  it.each(['draft', 'queued', 'awaiting_principal', 'resolved', 'failed', 'cancelled', 'expired'])(
    'does not restart or advance an errand in state %s on a contact reply', async (state) => {
      const errandService = makeErrandService({ get: vi.fn().mockReturnValue({ id: 'errand-1', state }) });
      const { negotiator, completionService } = makeNegotiator({ errandService });
      const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'Can we confirm?', messageHistory: [] });
      expect(result).toEqual({ reply: '', applied: 'skipped' });
      expect(completionService.complete).not.toHaveBeenCalled();
      expect(errandService.recordPeerReply).not.toHaveBeenCalled();
    },
  );

  it('discards a verdict if the errand was cancelled during the LLM call', async () => {
    const { negotiator, completionService, errandService } = makeNegotiator();
    completionService.complete.mockImplementationOnce(async () => {
      errandService.get.mockReturnValue({ id: 'errand-1', state: 'cancelled' });
      return { kind: 'message', text: JSON.stringify({ action: 'resolved', reply: 'Booked!' }) };
    });
    const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'Yes', messageHistory: [] });
    expect(result.applied).toBe('skipped');
    expect(errandService.resolve).not.toHaveBeenCalled();
  });

  it('leads every peer turn with the third-party conversation context', async () => {
    const { negotiator, promptRepository } = makeNegotiator();

    await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'hi', messageHistory: [] });

    const [call] = promptRepository.build.mock.calls[0];
    expect(call.extraSystemBlocks[0]).toBe(THIRD_PARTY_CONVERSATION_CONTEXT);
  });

  it.each(['', '   '])('uses default third-party instructions when saved instructions are %j', async (instructions) => {
    const { negotiator, sessionManager, promptRepository } = makeNegotiator();
    sessionManager.getSessionServiceById.mockImplementation(() => ({ getSession: () => ({ metadata: { instructions } }) }));

    await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'Hello', messageHistory: [] });

    expect(promptRepository.build.mock.calls[0][0].extraSystemBlocks[0]).toBe(THIRD_PARTY_CONVERSATION_CONTEXT);
  });

  describe('composeOpener', () => {
    it('generates a friendly opening message from the goal, fronted by the third-party context', async () => {
      const { negotiator, promptRepository } = makeNegotiator({
        completionText: 'Hi Ana! Guilherme asked me to check whether you still have the bike available.',
      });

      const opener = await negotiator.composeOpener({
        goal: 'buy milk', channel: 'whatsapp', peerId: 'ana', originSessionId: 'origin-1',
      });

      expect(opener).toBe('Hi Ana! Guilherme asked me to check whether you still have the bike available.');

      const [call] = promptRepository.build.mock.calls[0];
      expect(call.extraSystemBlocks[0]).toBe(THIRD_PARTY_CONVERSATION_CONTEXT);
      expect(call.extraSystemBlocks[1]).toContain('buy milk');
      expect(call.extraSystemBlocks[1]).toContain('ana');
      expect(call.extraSystemBlocks[1]).toContain('whatsapp');
      expect(call.includeMemory).toBe(false);
      expect(call.toolsEnabled).toBe(false);
    });

    it('falls back to the raw goal when the model returns nothing', async () => {
      const { negotiator } = makeNegotiator({ completionText: '   ' });

      const opener = await negotiator.composeOpener({
        goal: 'buy milk', channel: 'whatsapp', peerId: 'ana', originSessionId: 'origin-1',
      });

      expect(opener).toBe('buy milk');
    });

    it.each([new Error('provider down'), 'provider down'])('falls back to the raw goal when composition throws %s', async (error) => {
      const { negotiator, completionService } = makeNegotiator();
      completionService.complete.mockRejectedValueOnce(error);

      const opener = await negotiator.composeOpener({
        goal: 'buy milk', channel: 'whatsapp', peerId: 'ana', originSessionId: 'origin-1',
      });

      expect(opener).toBe('buy milk');
    });

    it('falls back to the goal when the provider returns tool calls instead of an opener', async () => {
      const { negotiator, completionService } = makeNegotiator();
      completionService.complete.mockResolvedValueOnce({ kind: 'tool_calls', calls: [] } as never);

      expect(await negotiator.composeOpener({ goal: 'buy milk', channel: 'whatsapp', peerId: 'ana', originSessionId: 'origin-1' })).toBe('buy milk');
    });
  });

  describe('composeResume', () => {
    it('rejects tool calls without forwarding private principal instructions', async () => {
      const { negotiator, completionService } = makeNegotiator();
      completionService.complete.mockResolvedValueOnce({ kind: 'tool_calls', calls: [] } as never);

      await expect(negotiator.composeResume({ errandId: 'e1', goal: 'Negotiate price', answer: 'Private limit is 100', channel: 'whatsapp', sessionId: 's1', messageHistory: [] })).rejects.toThrow('Nothing was sent');
    });

    it('generates a message incorporating the principal answer', async () => {
      const { negotiator, promptRepository } = makeNegotiator({
        completionText: 'Saturday at 10am works for Guilherme, let us lock that in.',
      });

      const reply = await negotiator.composeResume({
        errandId: 'e1',
        goal: 'haircut',
        notes: 'peer offered saturday 10am',
        answer: 'Saturday 10am is good',
        channel: 'whatsapp',
        sessionId: 's1',
        messageHistory: [],
      });

      expect(reply).toBe('Saturday at 10am works for Guilherme, let us lock that in.');
      const [call] = promptRepository.build.mock.calls[0];
      expect(call.extraSystemBlocks[0]).toBe(THIRD_PARTY_CONVERSATION_CONTEXT);
      expect(call.extraSystemBlocks[1]).toContain('haircut');
      expect(call.extraSystemBlocks[1]).toContain('Saturday 10am is good');
    });

    it('rejects an empty resume response without forwarding the principal answer', async () => {
      const { negotiator } = makeNegotiator({ completionText: '   ' });

      await expect(negotiator.composeResume({
        errandId: 'e1',
        goal: 'haircut',
        answer: 'Confirm Saturday',
        channel: 'whatsapp',
        sessionId: 's1',
        messageHistory: [],
      })).rejects.toThrow('Nothing was sent');
    });
  });

  it('"continue": records the peer reply, keeps the errand open, and replies', async () => {
    const { negotiator, errandService } = makeNegotiator({
      completionText: JSON.stringify({ action: 'continue', reply: 'Yes, still available!', notes: 'confirmed available' }),
    });

    const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'is it available?', messageHistory: [] });

    expect(errandService.recordPeerReply).toHaveBeenCalledWith('errand-1', 'confirmed available');
    expect(errandService.escalate).not.toHaveBeenCalled();
    expect(errandService.resolve).not.toHaveBeenCalled();
    expect(errandService.fail).not.toHaveBeenCalled();
    expect(result).toEqual({ reply: 'Yes, still available!', applied: 'continue' });
  });

  it.each([undefined, '', '   '])('"escalate": pushes the question to the principal and sends the contact nothing when reply is %s', async (reply) => {
    const { negotiator, errandService } = makeNegotiator({
      completionText: JSON.stringify({ action: 'escalate', reply, detail: 'what price should I offer?', notes: 'negotiating price' }),
    });

    const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'how much?', messageHistory: [] });

    expect(errandService.escalate).toHaveBeenCalledWith('errand-1', 'what price should I offer?', 'negotiating price');
    expect(result).toEqual({ reply: '', applied: 'escalate' });
  });

  it('"escalate": sends the model\'s own reply when one was given', async () => {
    const { negotiator } = makeNegotiator({
      completionText: JSON.stringify({ action: 'escalate', reply: 'Let me check with them.', detail: 'need budget approval' }),
    });

    const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'how much?', messageHistory: [] });

    expect(result.reply).toBe('Let me check with them.');
  });

  it('"resolved": proposes the result for the principal to confirm, holding the thank-you instead of sending it', async () => {
    const { negotiator, errandService } = makeNegotiator({
      completionText: JSON.stringify({ action: 'resolved', reply: 'Thanks, see you then!', detail: 'agreed on $10', notes: 'deal at $10' }),
    });

    const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'deal', messageHistory: [] });

    expect(errandService.proposeResolution).toHaveBeenCalledExactlyOnceWith('errand-1', 'agreed on $10', 'Thanks, see you then!', 'deal at $10');
    expect(errandService.resolve).not.toHaveBeenCalled();
    expect(result).toEqual({ reply: '', applied: 'resolved' });
  });

  it('keeps talking to the contact while a proposed result waits for confirmation', async () => {
    const errandService = makeErrandService({
      get: vi.fn().mockReturnValue({ id: 'errand-1', state: 'awaiting_confirmation', goal: 'buy milk', notes: 'deal at $10' }),
    });
    const { negotiator } = makeNegotiator({ errandService, completionText: JSON.stringify({ action: 'continue', reply: 'De nada!' }) });

    const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'Obrigado!', messageHistory: [] });

    expect(errandService.recordPeerReply).toHaveBeenCalledWith('errand-1', undefined);
    expect(result).toEqual({ reply: 'De nada!', applied: 'continue' });
  });

  it.each([undefined, '', '   '])('uses a thank-you fallback when the resolved reply is %s', async (reply) => {
    const { negotiator, errandService } = makeNegotiator({
      completionText: JSON.stringify({ action: 'resolved', reply, detail: 'Booking confirmed' }),
    });
    const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'Confirmed', messageHistory: [] });
    expect(errandService.proposeResolution).toHaveBeenCalledExactlyOnceWith('errand-1', 'Booking confirmed', 'Thank you for your help!', undefined);
    expect(result).toEqual({ reply: '', applied: 'resolved' });
  });

  it('"failed": closes the errand with the reason', async () => {
    const { negotiator, errandService } = makeNegotiator({
      completionText: JSON.stringify({ action: 'failed', reply: 'Okay, no problem.', detail: 'they are not interested' }),
    });

    const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'not interested', messageHistory: [] });

    expect(errandService.fail).toHaveBeenCalledWith('errand-1', 'they are not interested', undefined);
    expect(result).toEqual({ reply: 'Okay, no problem.', applied: 'failed' });
  });

  it('asks the principal for input when an escalation omits its question', async () => {
    const { negotiator, errandService } = makeNegotiator({ completionText: '{"action":"escalate"}' });

    const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'Which price?', messageHistory: [] });

    expect(errandService.escalate).toHaveBeenCalledExactlyOnceWith('errand-1', 'The negotiator needs your input.', undefined);
    expect(result).toEqual({ reply: '', applied: 'escalate' });
  });

  it.each([
    ['resolved', 'Thanks, confirmed.', 'Thanks, confirmed.'],
    ['resolved', '', 'Resolved.'],
    ['failed', 'Sorry, unavailable.', 'Sorry, unavailable.'],
    ['failed', '', 'Failed.'],
  ])('reports %s without detail using reply %j', async (action, reply, summary) => {
    const { negotiator, errandService } = makeNegotiator({ completionText: JSON.stringify({ action, reply }) });

    const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'Done', messageHistory: [] });

    if (action === 'resolved') {
      expect(errandService.proposeResolution).toHaveBeenCalledExactlyOnceWith('errand-1', summary, reply || 'Thank you for your help!', undefined);
      expect(result).toEqual({ reply: '', applied: 'resolved' });
    } else {
      expect(errandService.fail).toHaveBeenCalledExactlyOnceWith('errand-1', summary, undefined);
      expect(result).toEqual({ reply, applied: 'failed' });
    }
  });

  describe.each(['continue', 'failed'])('"%s" without a supplied reply', (action) => {
    it.each([undefined, '', '   '])('stays silent when reply is %s', async (reply) => {
      const { negotiator, errandService } = makeNegotiator({
        completionText: JSON.stringify({ action, reply, detail: 'Internal detail for the principal' }),
      });

      const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'No thanks', messageHistory: [] });

      expect(result).toEqual({ reply: '', applied: action });
      expect(errandService.proposeResolution).not.toHaveBeenCalled();
    });
  });

  it('skips the turn (no crash) when errands are unavailable', async () => {
    vi.mocked(buildErrandService).mockReturnValue(null);
    const completionService = makeCompletionService('irrelevant');
    const promptRepository = makePromptRepository();
    const negotiator = new Negotiator(makeLogger() as never, {} as never, makeSessionManager() as never, completionService as never, promptRepository as never);

    const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'hi', messageHistory: [] });

    expect(result).toEqual({ reply: '', applied: 'skipped' });
    expect(completionService.complete).not.toHaveBeenCalled();
  });

  it('skips the turn when the errand no longer exists', async () => {
    const errandService = makeErrandService({ get: vi.fn().mockReturnValue(null) });
    const { negotiator, completionService } = makeNegotiator({ errandService });

    const result = await negotiator.run({ errandId: 'missing', sessionId: 's1', channel: 'whatsapp', peerMessage: 'hi', messageHistory: [] });

    expect(result).toEqual({ reply: '', applied: 'skipped' });
    expect(completionService.complete).not.toHaveBeenCalled();
  });

  it('skips non-message completions without changing state', async () => {
    const errandService = makeErrandService();
    vi.mocked(buildErrandService).mockReturnValue(errandService as never);
    const completionService = { complete: vi.fn().mockResolvedValue({ kind: 'tool_calls', calls: [] }) };
    const promptRepository = makePromptRepository();
    const negotiator = new Negotiator(makeLogger() as never, {} as never, makeSessionManager() as never, completionService as never, promptRepository as never);

    const result = await negotiator.run({ errandId: 'errand-1', sessionId: 's1', channel: 'whatsapp', peerMessage: 'hi', messageHistory: [] });

    expect(errandService.recordPeerReply).not.toHaveBeenCalled();
    expect(result).toEqual({ reply: '', applied: 'skipped' });
  });
});
