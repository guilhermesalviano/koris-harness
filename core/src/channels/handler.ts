import type {
  ChannelHandlerOptions,
  ChannelReply,
  IChannelHandler,
  IChannelHandlerFactory,
  InboundChannelMessage,
  IMessageGateway,
} from '../../../plugins/channels/contracts';
import { splitMessage } from '../../../plugins/channels/contracts';
import { config } from '../config';
import { COMMANDS_RESTRICTED_MESSAGE } from '../constants';
import type { ILogger } from '../infrastructure/logger';
import { isCommand } from '../services/commands';
import { getSpeechSynthesisService, type AudioSynthesisResult } from '../services/audio/audio-synthesis-service';
import type { ISessionManager } from '../services/session-manager';
import { stripMarkdown } from '../utils/markdown';
import { sanitiseContextField } from '../utils/sanitise-context';
import { resolveResponse } from './utils';

export type {
  ChannelHandlerOptions,
  ChannelReply,
  InboundChannelMessage,
  IChannelHandler,
  IChannelHandlerFactory,
};

// Injected once at boot by `core/src/app.ts` so the handler can read a
// conversation's reply mode without threading a session dependency through
// every channel plugin's `ChannelHandlerOptions`.
let sessionManager: ISessionManager | undefined;
let handlerLogger: ILogger | undefined;

export function configureChannelHandler(deps: { sessionManager: ISessionManager; logger?: ILogger }): void {
  sessionManager = deps.sessionManager;
  handlerLogger = deps.logger;
}

class ChannelHandler implements IChannelHandler {
  private channel: string;
  private gateway: IMessageGateway;
  private reply: ChannelReply;
  private prefixSenderName: boolean;

  constructor(options: ChannelHandlerOptions) {
    this.channel = options.channel;
    this.gateway = options.gateway;
    this.reply = options.reply;
    this.prefixSenderName = options.prefixSenderName ?? true;
  }

  async handle(target: string, message: InboundChannelMessage): Promise<boolean> {
    if (message.isGroup && !message.mentionsBot) {
      return false;
    }

    // Channel plugins strip their own bot's mention before calling in — only
    // they know every identity it can be addressed by (phone number, LID,
    // display name), so core never sees an addressing token here.
    const text = message.text;

    if (isCommand(text) && !message.isTrustedSender) {
      await this.reply.sendText(target, COMMANDS_RESTRICTED_MESSAGE);
      return true;
    }

    const prompt = this.buildPrompt(message, text);

    try {
      const response = await this.gateway.handle(
        { text: prompt, images: message.images, stickers: message.stickers },
        target,
        {
          channel: this.channel,
          toolsEnabled: message.isTrustedSender,
          learnedSkillsEnabled: message.isTrustedSender,
          isTrustedSender: message.isTrustedSender,
          ...(message.peerAliases?.length ? { peerAliases: message.peerAliases } : {}),
        },
      );
      const resolved = await resolveResponse(response);
      if (!resolved.trim()) return true;
      const mode = this.readResponseMode(target);
      const canSendAudio = typeof this.reply.sendAudio === 'function';
      handlerLogger?.info(
        `[ChannelHandler] ${this.channel} reply to ${target}: mode=${mode}, channel can send audio=${canSendAudio}`,
      );
      if (mode === 'voice' && canSendAudio) {
        await this.deliverVoice(target, resolved);
      } else {
        if (mode === 'voice' && !canSendAudio) {
          handlerLogger?.warn(
            `[ChannelHandler] ${this.channel} is in voice mode but has no sendAudio — replying with text`,
          );
        }
        await this.reply.sendText(target, resolved);
      }
      return true;
    } catch (err) {
      const error = err instanceof Error
        ? err.message
        : 'Sorry, I ran into an unexpected problem. Could you try again?';
      await this.reply.sendError(target, `❌ ${error}`);
      return true;
    }
  }

  private readResponseMode(target: string): 'text' | 'voice' {
    if (!sessionManager) {
      handlerLogger?.warn('[ChannelHandler] sessionManager is not configured — defaulting reply mode to text');
      return 'text';
    }
    try {
      const metadata = sessionManager.getSessionService({ channel: this.channel, peerId: target }).getSession().metadata;
      const mode = metadata?.responseMode === 'voice' ? 'voice' : 'text';
      if (mode !== 'voice') {
        handlerLogger?.info(
          `[ChannelHandler] ${target} resolved to text mode (session metadata.responseMode=${JSON.stringify(metadata?.responseMode)})`,
        );
      }
      return mode;
    } catch (err) {
      handlerLogger?.warn(
        `[ChannelHandler] could not read responseMode for ${target}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'text';
    }
  }

  private async deliverVoice(target: string, text: string): Promise<void> {
    const plain = stripMarkdown(text);
    if (!plain.trim()) {
      handlerLogger?.info('[ChannelHandler] voice reply: text is empty after markdown strip, sending as text');
      await this.reply.sendText(target, text);
      return;
    }

    const service = getSpeechSynthesisService(handlerLogger);
    const chunks = splitMessage(plain, config.AUDIO.TTS.MAX_INPUT_CHARS);
    handlerLogger?.info(
      `[ChannelHandler] voice reply: ${chunks.length} chunk(s), tts.enabled=${config.AUDIO.TTS.ENABLED}, endpoint=${config.AUDIO.TTS.ENDPOINT}, voice=${config.AUDIO.TTS.VOICE}`,
    );
    const clips: AudioSynthesisResult[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const result = await service.synthesize(chunks[i], { format: 'ogg' });
      if (result.error || !result.audio) {
        const reason = result.error ?? 'synthesis produced no audio';
        handlerLogger?.warn(
          `[ChannelHandler] voice reply chunk ${i + 1}/${chunks.length} failed — falling back to text: ${reason}`,
        );
        await this.reply.sendText(target, text);
        await this.reply.sendText(target, `⚠️ (voice reply unavailable: ${reason})`);
        return;
      }
      handlerLogger?.info(
        `[ChannelHandler] voice reply chunk ${i + 1}/${chunks.length} synthesized: ${result.audio.length} bytes, ${result.contentType}, ${result.seconds ?? '?'}s`,
      );
      clips.push(result);
    }

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      try {
        await this.reply.sendAudio?.(target, clip.audio as Buffer, {
          mimeType: clip.contentType,
          seconds: clip.seconds,
        });
        handlerLogger?.info(`[ChannelHandler] voice reply clip ${i + 1}/${clips.length} sent to ${target}`);
      } catch (err) {
        handlerLogger?.error(
          `[ChannelHandler] voice reply clip ${i + 1}/${clips.length} send failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
        );
        throw err;
      }
    }
  }

  private buildPrompt(message: InboundChannelMessage, text: string): string {
    if (text.trim().startsWith('/')) {
      return text;
    }

    const parts: string[] = ['[Context]'];
    const trustSuffix = message.isTrustedSender ? '' : ' (untrusted sender)';
    if (message.groupName) {
      parts.push(`Chat: "${sanitiseContextField(message.groupName)}" (group)${trustSuffix}.`);
    } else if (message.isGroup) {
      parts.push(`Chat: group${trustSuffix}.`);
    } else {
      parts.push(`Chat: direct${trustSuffix}.`);
    }

    if (this.prefixSenderName && message.senderName) {
      parts.push(`Sender: ${sanitiseContextField(message.senderName)}.`);
    }

    if (message.quotedText) {
      parts.push(`Quoting: "${sanitiseContextField(message.quotedText).slice(0, 1024)}"`);
    } else if (message.images?.some((img) => img.source === 'quoted')) {
      parts.push('Quoting an image.');
    }

    if (text) {
      parts.push(`Message: ${text}`);
    }

    return parts.join(' ');
  }
}

class ChannelHandlerFactory {
  static create(options: ChannelHandlerOptions): ChannelHandler {
    return new ChannelHandler(options);
  }
}

export { ChannelHandler, ChannelHandlerFactory };
