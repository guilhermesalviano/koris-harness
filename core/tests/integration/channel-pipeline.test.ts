import { describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config';

const getRecent = vi.fn().mockReturnValue([
  { name: 'cat-fact', description: 'Random cat facts', content: 'Skill docs: call catfact.ninja.' },
]);

vi.mock('../../src/infrastructure/db-sqlite', () => ({
  DatabaseServiceFactory: { create: () => ({}) },
}));

vi.mock('../../src/repositories/learned-skills', () => ({
  LearnedSkillsRepositoryFactory: { create: () => ({ getRecent }) },
}));
import { ChannelHandlerFactory } from '../../src/channels/handler';
import { MessageGateway } from '../../src/services/agents/message-gateway';
import { splitMessage } from '../../../plugins/channels/contracts';
import type {
  ChannelReply,
  IMessageGateway,
  InboundChannelMessage,
} from '../../../plugins/channels/contracts';
import type { ILogger } from '../../src/infrastructure/logger';

const CHUNK_LIMIT = 4_000; // every shipped plugin splits outbound text at 4000

function makeLogger(): ILogger {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

function makeReply() {
  const texts: string[] = [];
  const errors: string[] = [];
  const reply: ChannelReply = {
    async sendText(_target, text) {
      for (const chunk of splitMessage(text, CHUNK_LIMIT)) texts.push(chunk);
    },
    async sendError(_target, message) {
      errors.push(message);
    },
  };
  return { reply, texts, errors };
}

function makeGatewayWithFakeAgent(mainAgentReply: string) {
  const sessionService = { getSession: vi.fn().mockReturnValue({ id: 'session-1' }) };
  const messageService = { getHistory: vi.fn(), getSessionId: vi.fn().mockReturnValue('session-1'), save: vi.fn() };
  const memoryService = { upsert: vi.fn() };
  const mainAgent = { run: vi.fn().mockResolvedValue(mainAgentReply) };

  const gateway = new MessageGateway(
    makeLogger(),
    'test-channel',
    { resolve: vi.fn().mockReturnValue({ sessionService, messageService, memoryService }) } as never,
    { persistConversation: vi.fn(), summarizeConversation: vi.fn() } as never,
    mainAgent as never,
    { record: vi.fn() } as never,
    { findAll: vi.fn().mockReturnValue([]) } as never,
  );

  return { gateway, mainAgent };
}

function inbound(overrides: Partial<InboundChannelMessage> = {}): InboundChannelMessage {
  return {
    text: 'hello koris',
    senderName: 'Guilherme',
    isGroup: false,
    mentionsBot: false,
    isTrustedSender: true,
    ...overrides,
  };
}

function makeHandler(gateway: IMessageGateway, reply: ChannelReply) {
  return ChannelHandlerFactory.create({ channel: 'test-channel', gateway, reply });
}

describe('channel-agnostic end-to-end pipeline', () => {
  it('runs a direct message through the real ChannelHandler and MessageGateway', async () => {
    const { gateway, mainAgent } = makeGatewayWithFakeAgent('Hi there!');
    const { reply, texts } = makeReply();

    const handled = await makeHandler(gateway, reply).handle('user-1', inbound({ text: 'hello koris' }));

    expect(handled).toBe(true);
    expect(mainAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: expect.stringContaining('Message: hello koris'),
        channel: 'test-channel',
        target: 'user-1',
      }),
    );
    expect(texts).toEqual(['Hi there!']);
  });

  it('splits a long agent reply into multiple channel-sized chunks', async () => {
    const { gateway } = makeGatewayWithFakeAgent('x'.repeat(9_000));
    const { reply, texts } = makeReply();

    await makeHandler(gateway, reply).handle('user-1', inbound({ text: 'give me the essay' }));

    expect(texts.length).toBeGreaterThan(1);
    expect(texts.every((chunk) => chunk.length <= CHUNK_LIMIT)).toBe(true);
  });

  it('forwards image attachments to the main agent unchanged', async () => {
    const { gateway, mainAgent } = makeGatewayWithFakeAgent('nice photo');
    const { reply } = makeReply();
    const images = [{ data: 'aW1nLWJ5dGVz', mimeType: 'image/png' }];

    await makeHandler(gateway, reply).handle('user-1', inbound({ text: 'look at this', images }));

    expect(mainAgent.run).toHaveBeenCalledWith(expect.objectContaining({ images }));
  });

  it('drops a group message with no bot mention before it reaches the agent', async () => {
    const { gateway, mainAgent } = makeGatewayWithFakeAgent('unused');
    const { reply, texts } = makeReply();

    const handled = await makeHandler(gateway, reply).handle(
      'group-1',
      inbound({ isGroup: true, mentionsBot: false, groupName: 'Family', text: 'no mention here' }),
    );

    expect(handled).toBe(false);
    expect(mainAgent.run).not.toHaveBeenCalled();
    expect(texts).toEqual([]);
  });

  // The channel plugin owns mention detection and stripping, so a message that
  // addressed the bot arrives here flagged and already clean.
  it('processes a group message that addressed the bot, with no addressing token left in the prompt', async () => {
    const { gateway, mainAgent } = makeGatewayWithFakeAgent('on it');
    const { reply } = makeReply();

    await makeHandler(gateway, reply).handle(
      'group-1',
      inbound({ isGroup: true, mentionsBot: true, groupName: 'Family', text: 'hey help' }),
    );

    expect(mainAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: expect.stringContaining('Chat: "Family" (group)'),
      }),
    );
    const prompt = mainAgent.run.mock.calls[0][0].userMessage as string;
    expect(prompt).not.toContain('@korisbot');
  });

  it('passes sender trust through to the gateway options and the prompt', async () => {
    const { gateway, mainAgent } = makeGatewayWithFakeAgent('ok');
    const { reply } = makeReply();

    await makeHandler(gateway, reply).handle('user-2', inbound({ isTrustedSender: false, text: 'hi' }));

    expect(mainAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: expect.stringContaining('(untrusted sender)'),
        options: expect.objectContaining({ toolsEnabled: false, learnedSkillsEnabled: false }),
      }),
    );
  });

  it('routes a slash command through the command layer instead of the agent', async () => {
    const { gateway, mainAgent } = makeGatewayWithFakeAgent('unused');
    const { reply, texts } = makeReply();

    await makeHandler(gateway, reply).handle('user-1', inbound({ text: '/help' }));

    expect(mainAgent.run).not.toHaveBeenCalled();
    expect(texts.join('\n')).toContain('/help');
  });

  it('loads a skill and falls through to the agent when a skill command is used', async () => {
    const originalMode = config.SKILLS.MODE;
    (config.SKILLS as { MODE: string }).MODE = 'manual';

    try {
      const { gateway, mainAgent } = makeGatewayWithFakeAgent('Cats sleep a lot.');
      const { reply, texts } = makeReply();

      await makeHandler(gateway, reply).handle('user-1', inbound({ text: '/cat-fact tell me one' }));

      expect(mainAgent.run).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: 'tell me one',
          options: expect.objectContaining({
            skillBlocks: [expect.stringContaining('Skill docs: call catfact.ninja.')],
          }),
        }),
      );
      expect(texts.join('\n')).toContain('Cats sleep a lot.');

      const block = mainAgent.run.mock.calls[0][0].options.skillBlocks[0] as string;
      expect(block).toContain('# Skill Invoked: cat-fact');
    } finally {
      (config.SKILLS as { MODE: string }).MODE = originalMode;
    }
  });

  it('leaves a skill command to the agent as plain text in auto mode', async () => {
    const originalMode = config.SKILLS.MODE;
    (config.SKILLS as { MODE: string }).MODE = 'auto';

    try {
      const { gateway, mainAgent } = makeGatewayWithFakeAgent('Sure.');
      const { reply } = makeReply();

      await makeHandler(gateway, reply).handle('user-1', inbound({ text: '/cat-fact tell me one' }));

      expect(mainAgent.run).toHaveBeenCalledWith(
        expect.objectContaining({ userMessage: '/cat-fact tell me one' }),
      );
      expect(mainAgent.run.mock.calls[0][0].options.skillBlocks).toBeUndefined();
    } finally {
      (config.SKILLS as { MODE: string }).MODE = originalMode;
    }
  });

  it('refuses a slash command from an untrusted sender before the command layer', async () => {
    const { gateway, mainAgent } = makeGatewayWithFakeAgent('unused');
    const commandSpy = vi.spyOn(gateway, 'handle');
    const { reply, texts } = makeReply();

    const handled = await makeHandler(gateway, reply).handle(
      'user-2',
      inbound({ text: '/clear', isTrustedSender: false }),
    );

    expect(handled).toBe(true);
    expect(commandSpy).not.toHaveBeenCalled();
    expect(mainAgent.run).not.toHaveBeenCalled();
    expect(texts.join('\n')).toContain('authorized users');
  });

  it('replies with an error message when the main agent throws, without rejecting', async () => {
    const { gateway, mainAgent } = makeGatewayWithFakeAgent('unused');
    mainAgent.run.mockRejectedValue(new Error('provider unavailable'));
    const { reply, errors, texts } = makeReply();

    const handled = await makeHandler(gateway, reply).handle('user-1', inbound({ text: 'hello' }));

    expect(handled).toBe(true);
    expect(texts).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('provider unavailable');
  });
});
