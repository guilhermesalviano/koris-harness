import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelHandlerFactory, configureChannelHandler } from '../../../src/channels/handler';
import { COMMANDS_RESTRICTED_MESSAGE } from '../../../src/constants/commands';
import { RESPONSE_ANCHOR, THINK_END, THINK_START } from '../../../src/constants/thinking';
import type { InboundChannelMessage } from '../../../src/channels/handler';

const { mockSynthesize } = vi.hoisted(() => ({ mockSynthesize: vi.fn() }));
vi.mock('../../../src/services/audio/audio-synthesis-service', () => ({
  getSpeechSynthesisService: () => ({ synthesize: mockSynthesize }),
}));

function configureMode(mode: 'text' | 'voice'): void {
  configureChannelHandler({
    sessionManager: {
      getSessionService: () => ({ getSession: () => ({ metadata: { responseMode: mode } }) }),
    } as never,
  });
}

function makeHandler() {
  const gateway = { handle: vi.fn() };
  const reply = {
    sendText: vi.fn(),
    sendError: vi.fn(),
  };
  const handler = ChannelHandlerFactory.create({
    channel: 'test-channel',
    gateway,
    reply,
  });
  return { handler, gateway, reply };
}

function message(overrides: Partial<InboundChannelMessage> = {}): InboundChannelMessage {
  return {
    text: 'hello',
    isGroup: false,
    mentionsBot: false,
    isTrustedSender: false,
    ...overrides,
  };
}

async function* createResponseStream(): AsyncGenerator<string> {
  yield THINK_START;
  yield 'internal reasoning';
  yield THINK_END;
  yield RESPONSE_ANCHOR;
  yield 'Visible reply';
}

describe('channels/handler', () => {
  it('skips group messages that do not mention the bot', async () => {
    const { handler, gateway, reply } = makeHandler();

    const processed = await handler.handle('group@g.us', message({ isGroup: true, mentionsBot: false }));

    expect(processed).toBe(false);
    expect(gateway.handle).not.toHaveBeenCalled();
    expect(reply.sendText).not.toHaveBeenCalled();
  });

  it('processes group messages that mention the bot', async () => {
    const { handler, gateway, reply } = makeHandler();
    gateway.handle.mockResolvedValue('pong');

    const processed = await handler.handle('group@g.us', message({ isGroup: true, mentionsBot: true }));

    expect(processed).toBe(true);
    expect(gateway.handle).toHaveBeenCalled();
    expect(reply.sendText).toHaveBeenCalledWith('group@g.us', 'pong');
  });

  it('prefixes the prompt with the sender name', async () => {
    const { handler, gateway, reply } = makeHandler();
    gateway.handle.mockResolvedValue('pong');

    await handler.handle('jid', message({ senderName: 'guilherme', text: 'hi' }));

    expect(gateway.handle).toHaveBeenCalledWith(
      { text: '[Context] Chat: direct (untrusted sender). Sender: guilherme. Message: hi', images: undefined, stickers: undefined },
      'jid',
      { channel: 'test-channel', toolsEnabled: false, learnedSkillsEnabled: false },
    );
  });

  it('includes quoted text in the prompt', async () => {
    const { handler, gateway } = makeHandler();
    gateway.handle.mockResolvedValue('pong');

    await handler.handle('jid', message({ senderName: 'guilherme', text: 'hi', quotedText: 'the original message' }));

    expect(gateway.handle).toHaveBeenCalledWith(
      { text: '[Context] Chat: direct (untrusted sender). Sender: guilherme. Quoting: "the original message" Message: hi', images: undefined },
      'jid',
      expect.any(Object),
    );
  });

  it('notes a quoted image in the prompt when there is no quoted text', async () => {
    const { handler, gateway } = makeHandler();
    gateway.handle.mockResolvedValue('pong');

    await handler.handle('jid', message({
      senderName: 'guilherme',
      text: 'hi',
      images: [{ data: 'abc', mimeType: 'image/jpeg', source: 'quoted' }],
    }));

    expect(gateway.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '[Context] Chat: direct (untrusted sender). Sender: guilherme. Quoting an image. Message: hi',
      }),
      'jid',
      expect.any(Object),
    );
  });

  it('does not prefix the sender name when prefixSenderName is disabled', async () => {
    const gateway = { handle: vi.fn().mockResolvedValue('pong') };
    const reply = { sendText: vi.fn(), sendError: vi.fn() };
    const handler = ChannelHandlerFactory.create({
      channel: 'test-channel',
      gateway,
      reply,
      prefixSenderName: false,
    });

    await handler.handle('jid', message({ senderName: 'guilherme', text: 'hi' }));

    expect(gateway.handle).toHaveBeenCalledWith(
      { text: '[Context] Chat: direct (untrusted sender). Message: hi', images: undefined },
      'jid',
      expect.any(Object),
    );
  });

  it('prefixes group messages with the group name', async () => {
    const { handler, gateway, reply } = makeHandler();
    gateway.handle.mockResolvedValue('pong');

    await handler.handle('group@g.us', message({
      isGroup: true,
      mentionsBot: true,
      senderName: 'guilherme',
      groupName: 'Family',
      text: 'hi',
    }));

    expect(gateway.handle).toHaveBeenCalledWith(
      { text: '[Context] Chat: "Family" (group) (untrusted sender). Sender: guilherme. Message: hi', images: undefined },
      'group@g.us',
      expect.any(Object),
    );
  });

  it('prefixes group messages without a name as bare group', async () => {
    const { handler, gateway, reply } = makeHandler();
    gateway.handle.mockResolvedValue('pong');

    await handler.handle('group@g.us', message({
      isGroup: true,
      mentionsBot: true,
      senderName: 'guilherme',
      text: 'hi',
    }));

    expect(gateway.handle).toHaveBeenCalledWith(
      { text: '[Context] Chat: group (untrusted sender). Sender: guilherme. Message: hi', images: undefined },
      'group@g.us',
      expect.any(Object),
    );
  });

  it('does not prefix commands so they still reach the command handler', async () => {
    const { handler, gateway, reply } = makeHandler();
    gateway.handle.mockResolvedValue('pong');

    await handler.handle('jid', message({ senderName: 'guilherme', text: '/help', isTrustedSender: true }));

    expect(gateway.handle).toHaveBeenCalledWith(
      { text: '/help', images: undefined },
      'jid',
      expect.any(Object),
    );
  });

  it('refuses commands from untrusted senders before they reach the gateway', async () => {
    const { handler, gateway, reply } = makeHandler();

    const processed = await handler.handle('jid', message({ text: '/help', isTrustedSender: false }));

    expect(processed).toBe(true);
    expect(gateway.handle).not.toHaveBeenCalled();
    expect(reply.sendText).toHaveBeenCalledWith('jid', COMMANDS_RESTRICTED_MESSAGE);
  });

  // The channel plugin strips its bot's mention before handing the message over,
  // so what arrives here is the bare command.
  it('refuses commands from untrusted senders even when the message addressed the bot', async () => {
    const { handler, gateway, reply } = makeHandler();

    await handler.handle('jid', message({ text: '/compact', isTrustedSender: false }));

    expect(gateway.handle).not.toHaveBeenCalled();
    expect(reply.sendText).toHaveBeenCalledWith('jid', COMMANDS_RESTRICTED_MESSAGE);
  });

  it('lets untrusted senders send normal (non-command) messages', async () => {
    const { handler, gateway, reply } = makeHandler();
    gateway.handle.mockResolvedValue('pong');

    await handler.handle('jid', message({ text: 'hello there', isTrustedSender: false }));

    expect(gateway.handle).toHaveBeenCalled();
    expect(reply.sendText).toHaveBeenCalledWith('jid', 'pong');
  });

  it('enables tools and learned skills only for trusted senders', async () => {
    const { handler, gateway, reply } = makeHandler();
    gateway.handle.mockResolvedValue('pong');

    await handler.handle('jid', message({ isTrustedSender: true }));

    expect(gateway.handle).toHaveBeenCalledWith(
      expect.anything(),
      'jid',
      { channel: 'test-channel', toolsEnabled: true, learnedSkillsEnabled: true },
    );
  });

  it('gives untrusted senders no tools', async () => {
    const { handler, gateway } = makeHandler();
    gateway.handle.mockResolvedValue('pong');

    await handler.handle('jid', message({ isTrustedSender: false }));

    expect(gateway.handle).toHaveBeenCalledWith(
      expect.anything(),
      'jid',
      { channel: 'test-channel', toolsEnabled: false, learnedSkillsEnabled: false },
    );
  });

  it('strips think output before replying', async () => {
    const { handler, gateway, reply } = makeHandler();
    gateway.handle.mockResolvedValue(createResponseStream());

    await handler.handle('jid', message({}));

    expect(reply.sendText).toHaveBeenCalledWith('jid', 'Visible reply');
  });

  it('coerces non-string non-stream responses with String()', async () => {
    const { handler, gateway, reply } = makeHandler();
    gateway.handle.mockResolvedValue(42);

    await handler.handle('jid', message({}));

    expect(reply.sendText).toHaveBeenCalledWith('jid', '42');
  });

  it('sends an error reply when the agent throws', async () => {
    const { handler, gateway, reply } = makeHandler();
    gateway.handle.mockRejectedValue(new Error('boom'));

    await handler.handle('jid', message({}));

    expect(reply.sendText).not.toHaveBeenCalled();
    expect(reply.sendError).toHaveBeenCalledWith('jid', '❌ boom');
  });

  it('uses a friendly fallback when the error has no message', async () => {
    const { handler, gateway, reply } = makeHandler();
    gateway.handle.mockRejectedValue('raw failure');

    await handler.handle('jid', message({}));

    expect(reply.sendError).toHaveBeenCalledWith('jid', '❌ Sorry, I ran into an unexpected problem. Could you try again?');
  });

  describe('voice mode', () => {
    afterEach(() => {
      configureChannelHandler({ sessionManager: undefined as never });
      mockSynthesize.mockReset();
    });

    function makeVoiceHandler() {
      const gateway = { handle: vi.fn().mockResolvedValue('the spoken reply') };
      const reply = { sendText: vi.fn(), sendError: vi.fn(), sendAudio: vi.fn() };
      const handler = ChannelHandlerFactory.create({ channel: 'test-channel', gateway, reply });
      return { handler, gateway, reply };
    }

    it('synthesizes and sends audio instead of text when the conversation is in voice mode', async () => {
      configureMode('voice');
      mockSynthesize.mockResolvedValue({ audio: Buffer.from('ogg-bytes'), contentType: 'audio/ogg', seconds: 2 });
      const { handler, reply } = makeVoiceHandler();

      await handler.handle('jid', message({ text: 'hi' }));

      expect(mockSynthesize).toHaveBeenCalledWith('the spoken reply', { format: 'ogg' });
      expect(reply.sendAudio).toHaveBeenCalledWith('jid', expect.any(Buffer), { mimeType: 'audio/ogg', seconds: 2 });
      expect(reply.sendText).not.toHaveBeenCalled();
    });

    it('falls back to text with a note when synthesis fails', async () => {
      configureMode('voice');
      mockSynthesize.mockResolvedValue({ audio: null, contentType: '', error: 'sidecar offline' });
      const { handler, reply } = makeVoiceHandler();

      await handler.handle('jid', message({ text: 'hi' }));

      expect(reply.sendAudio).not.toHaveBeenCalled();
      expect(reply.sendText).toHaveBeenNthCalledWith(1, 'jid', 'the spoken reply');
      expect(reply.sendText).toHaveBeenNthCalledWith(2, 'jid', expect.stringContaining('sidecar offline'));
    });

    it('sends text when the conversation is in text mode', async () => {
      configureMode('text');
      const { handler, reply } = makeVoiceHandler();

      await handler.handle('jid', message({ text: 'hi' }));

      expect(mockSynthesize).not.toHaveBeenCalled();
      expect(reply.sendText).toHaveBeenCalledWith('jid', 'the spoken reply');
    });

    it('sends text when the channel has no sendAudio, even in voice mode', async () => {
      configureMode('voice');
      const gateway = { handle: vi.fn().mockResolvedValue('the spoken reply') };
      const reply = { sendText: vi.fn(), sendError: vi.fn() };
      const handler = ChannelHandlerFactory.create({ channel: 'test-channel', gateway, reply });

      await handler.handle('jid', message({ text: 'hi' }));

      expect(mockSynthesize).not.toHaveBeenCalled();
      expect(reply.sendText).toHaveBeenCalledWith('jid', 'the spoken reply');
    });
  });
});