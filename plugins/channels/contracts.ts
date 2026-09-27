import { ExtensionPoint } from '../registry';

export { ExtensionPoint };
export type { Plugin } from '../registry';

export interface ImageAttachment {
  data: string;
  mimeType?: string;
  /** Where this image came from: attached to the current message, or from a quoted/replied-to message. Absent means 'current'. */
  source?: 'current' | 'quoted';
}

/**
 * A pointer to a sticker on the channel's own servers (e.g. WhatsApp's media
 * CDN), captured from a quoted/replied-to message. Carries no decoded bytes —
 * `key`/`message` are exactly what the channel needs to re-send the sticker
 * by reference later (e.g. WhatsApp's "forward" mechanism).
 */
export interface StickerReference {
  key: {
    remoteJid: string;
    id?: string;
    participant?: string;
    fromMe: boolean;
  };
  message: unknown;
  mimeType?: string;
}

export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export type ProcessedMessage = string;
export type ProcessOptions = {
  signal?: AbortSignal;
  toolsEnabled?: boolean;
  learnedSkillsEnabled?: boolean;
  onProgress?: (summary: string) => void;
  /** Fired when a turn rotates the session (e.g. `/compact`) so the caller can follow the new id. */
  onSessionRotated?: (newSessionId: string) => void;
  sessionId?: string;
  runId?: string;
  channel?: string;
  /** Skill documentation loaded for this turn only, by a `/<skill>` command. */
  skillBlocks?: string[];
  /** Forwarded from `InboundChannelMessage.isTrustedSender` so the gateway can
   * route an untrusted peer with an active errand to the negotiator instead
   * of the principal's own session. Undefined (web/tui) is treated as trusted. */
  isTrustedSender?: boolean;
  /** Forwarded from `InboundChannelMessage.peerAliases` so an errand addressed
   * to one of the contact's other addresses still matches their reply. */
  peerAliases?: string[];
};

export type InboundInput = string | { text: string; images?: ImageAttachment[]; stickers?: StickerReference[] };

export interface IMessageGateway {
  handle(input: InboundInput, originId: string, options?: ProcessOptions): Promise<ProcessedMessage>;
}

/**
 * What a channel can actually do, so core can degrade behavior once instead
 * of branching on channel identity (see AGENTS.md / FINDINGS.md §2.8 for the
 * `source === 'telegram'` conditionals this is meant to eventually replace).
 * Optional on `ChannelDefinition` for now — additive; neither plugin declares
 * it yet, and everything that reads it must treat its absence as "assume the
 * least capable channel" (no streaming, no markdown, no interactive buttons).
 */
export interface ChannelCapabilities {
  /** Can this channel edit a message it already sent, in place? */
  streaming: boolean;
  /** Does this channel render Markdown-ish formatting in message text? */
  markdown: boolean;
  /** Does this channel have a real, clickable-button affordance for approvals? */
  interactive: boolean;
  /** The channel's real per-message character ceiling, for `splitMessage`. */
  maxMessageChars: number;
}

/**
 * An outbound byte payload a channel can send back — e.g. a generated image
 * or document. Distinct from `ImageAttachment` (inbound-only, includes
 * `source: 'quoted'`) and `StickerReference` (a pointer, no bytes): this is
 * the outbound counterpart introduced for `OutboundEvent`.
 */
export interface Attachment {
  data: string;
  mimeType?: string;
  filename?: string;
}

/**
 * Closed set of things a channel can be asked to send. Additive, unused by
 * either plugin today — Phase 3/4 wire real channels onto it. Each channel's
 * `send`/`switch` over this type should end in a `default: assertNeverOutboundEvent(event)`
 * branch so a new variant fails the build instead of silently doing nothing.
 */
export type OutboundEvent =
  | { type: 'delta'; text: string }
  | { type: 'message'; text: string }
  | { type: 'tool'; name: string; status: 'start' | 'ok' | 'error'; summary?: string }
  | { type: 'approval'; id: string; prompt: string; options: string[] }
  | { type: 'attachment'; attachment: Attachment; caption?: string }
  | { type: 'error'; message: string }
  | { type: 'turn_end' };

/**
 * Exhaustiveness helper for a `switch` over `OutboundEvent`. Put this in the
 * `default` branch (typed as `never`) so adding a new `OutboundEvent` variant
 * is a compile error in every channel that switches over it, not a silent
 * no-op — see Definition of Done: "Adding an `OutboundEvent` variant causes a
 * type error in both plugins."
 */
export function assertNeverOutboundEvent(event: never): never {
  throw new Error(`Unhandled OutboundEvent: ${JSON.stringify(event)}`);
}

/**
 * Target lifecycle shape for a channel plugin instance — generalizes today's
 * `ChannelDefinition.start(logger, gateway) => stop?` plus the separate
 * `sendMessage?`/`sendSticker?` methods into a single `send(target, event)`
 * over the closed `OutboundEvent` union. Additive: `ChannelDefinition` keeps
 * working exactly as today; this describes what Phase 3/4 migrate each
 * plugin's `create()` to return, and what a future 3rd channel can implement
 * directly instead of the older shape.
 */
export interface ChannelInstance {
  start(): void | Promise<void>;
  send(target: string, event: OutboundEvent): Promise<void>;
  stop(): void | Promise<void>;
}

export interface ChannelDefinition {
  name: string;
  enabled: () => boolean;
  start: (logger: ILogger, gateway: IMessageGateway) => (() => void) | void;
  sendMessage?: (logger: ILogger, target: string, message: string) => Promise<void>;
  sendSticker?: (logger: ILogger, target: string, sticker: StickerReference) => Promise<void>;
  /** Optional today — see `ChannelCapabilities`. Absence means "assume the least capable channel." */
  capabilities?: ChannelCapabilities;
}

export interface InboundChannelMessage {
  text: string;
  senderName?: string;
  images?: ImageAttachment[];
  stickers?: StickerReference[];
  /** Text of the message being replied to/quoted, if any. */
  quotedText?: string;
  isGroup: boolean;
  mentionsBot: boolean;
  isTrustedSender: boolean;
  groupName?: string;
  /**
   * The channel's own id for this specific message (Telegram `message_id`,
   * Baileys `key.id`) — optional today; needed for the dedupe work in
   * FINDINGS.md §3.4 (Baileys replays `messages.upsert` after reconnect).
   * Neither plugin sets this yet.
   */
  externalId?: string;
  /**
   * The channel's native conversation id (Telegram chat id, WhatsApp JID) —
   * optional today, distinct from the `target`/`originId` string `handle()`
   * already receives, for cases where a message needs to carry its own
   * conversation identity independent of the delivery target.
   */
  conversationId?: string;
  /**
   * Other addresses the same sender is known by on this channel, besides the
   * `target` passed to `handle()` — e.g. the phone-number JID
   * (`<n>@s.whatsapp.net`) of a WhatsApp message that arrived under a LID
   * (`<n>@lid`). Lets core match a reply to an errand sent to the other form.
   */
  peerAliases?: string[];
}

export interface ChannelReply {
  sendText(target: string, text: string): Promise<void>;
  sendError(target: string, message: string): Promise<void>;
  /**
   * Deliver a reply as an audio voice note. Optional: channels that cannot
   * send audio simply omit it and the handler falls back to `sendText`.
   */
  sendAudio?(
    target: string,
    audio: Buffer,
    opts?: { mimeType?: string; seconds?: number },
  ): Promise<void>;
}

export interface ChannelHandlerOptions {
  channel: string;
  gateway: IMessageGateway;
  reply: ChannelReply;
  prefixSenderName?: boolean;
}

export interface IChannelHandler {
  handle(target: string, message: InboundChannelMessage): Promise<boolean>;
}

export interface IChannelHandlerFactory {
  create(options: ChannelHandlerOptions): IChannelHandler;
}

/**
 * A channel plugin's "start it now, outside boot-time `ChannelsManager`
 * registration" surface, exported as `liveChannel` from the plugin's entry
 * module. The dashboard discovers these by scanning `plugins/channels/*` (see
 * `listLiveChannels`) instead of importing each channel by name, so adding a
 * channel needs no dashboard change.
 *
 * `configureRuntime` re-reads the plugin's `config.yml` into its module-level
 * runtime state (whitelist, `allow_unlisted_senders`, …) without touching any
 * socket. `start` primes that state then opens the connection, resolving to the
 * plugin's `stop` fn. `loadConfig`/`writeConfigPatch` expose the plugin's
 * `config.yml` as an opaque record for the admin settings API.
 */
export interface LiveChannelDescriptor {
  name: string;
  configureRuntime(opts: { channelHandler: IChannelHandlerFactory }): Record<string, unknown>;
  start(opts: {
    channelHandler: IChannelHandlerFactory;
    gateway: IMessageGateway;
    logger: ILogger;
  }): Promise<{ stop: () => void }>;
  loadConfig(): Record<string, unknown>;
  writeConfigPatch(patch: Record<string, unknown>): void;
}

export const ADAPTERS = new ExtensionPoint<ChannelDefinition>('channels.adapters');

export function splitMessage(text: string, maxLength: number): string[] {
  if (!text) return [];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const candidate = remaining.slice(0, maxLength);
    const splitIndex = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
    const end = splitIndex > 0 ? splitIndex : maxLength;

    chunks.push(remaining.slice(0, end).trimEnd());
    remaining = remaining.slice(end).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/** Copied from `plugins/tools/contracts.ts` — same shape, not imported, so no plugin family depends on another. */
export interface IPluginEnablementGateway {
  isEnabled(name: string): boolean;
}

export interface AudioTranscriber {
  transcribe(
    audio: Buffer,
    options?: { filename?: string; mimeType?: string }
  ): Promise<{ text: string; error?: string }>;
}

export interface PluginContext {
  logger: ILogger;
  gateway: IMessageGateway;
  channelHandler: IChannelHandlerFactory;
  pluginEnablement: IPluginEnablementGateway;
  audioTranscriber?: AudioTranscriber;
}