import type { ILogger } from '../infrastructure/logger';
import type { IMessageGateway } from '../services/agents/message-gateway';
import type {
  Attachment,
  ChannelCapabilities,
  ChannelDefinition,
  ChannelHandlerOptions,
  ChannelInstance,
  ChannelReply,
  IChannelHandler,
  IChannelHandlerFactory,
  InboundChannelMessage,
  OutboundEvent,
  StickerReference,
} from '../../../plugins/channels/contracts';
import { ADAPTERS, assertNeverOutboundEvent } from '../../../plugins/channels/contracts';
import { ChannelHandler, ChannelHandlerFactory, configureChannelHandler } from './handler';
import { resolveResponse, splitForCapabilities, splitMessage } from './utils';
import type { ChannelOverride } from '../config/channel-overrides';

export type {
  Attachment,
  ChannelCapabilities,
  ChannelDefinition,
  ChannelHandlerOptions,
  ChannelInstance,
  ChannelReply,
  IChannelHandler,
  IChannelHandlerFactory,
  InboundChannelMessage,
  OutboundEvent,
};
export {
  ADAPTERS,
  assertNeverOutboundEvent,
  ChannelHandler,
  ChannelHandlerFactory,
  configureChannelHandler,
  resolveResponse,
  splitForCapabilities,
  splitMessage,
};

export type StopFn = () => void;

/**
 * Applies koris.json's optional `channels.overrides` onto an already-built
 * `ChannelDefinition[]` (see `core/src/config/channel-overrides.ts` for the
 * schema and its limits). Only wraps `enabled()` — it can flip an
 * already-registered channel off (or back on), nothing more. A channel with
 * no matching override is returned unchanged.
 */
export function applyChannelOverrides(
  channels: ChannelDefinition[],
  overrides: Record<string, ChannelOverride>,
): ChannelDefinition[] {
  return channels.map((channel) => {
    const override = overrides[channel.name];
    if (override?.enabled === undefined) {
      return channel;
    }
    const enabled = override.enabled;
    return { ...channel, enabled: () => enabled };
  });
}

export interface IChannelsManager {
  startAll(): void;
  stopAll(): void;
  stopChannel(name: string): void;
  sendMessage(channel: string, target: string, message: string): Promise<void>;
  sendSticker(channel: string, target: string, sticker: StickerReference): Promise<void>;
  /**
   * The logger and gateway this manager was built with. The admin API receives
   * both from its own factory, but a chat command only has a channel name — it
   * reads them from here so `/channels activate` can bring a channel up live
   * through the same `startChannelLive` path the dashboard uses.
   */
  readonly runtimeDeps: { logger: ILogger; gateway: IMessageGateway };
}

class ChannelsManager implements IChannelsManager {
  private logger: ILogger;
  private gateway: IMessageGateway;
  private stopFnsByName = new Map<string, StopFn>();
  private channels: ChannelDefinition[];

  constructor(
    logger: ILogger,
    gateway: IMessageGateway,
    channels: ChannelDefinition[] = [],
  ) {
    this.logger = logger;
    this.gateway = gateway;
    this.channels = channels;
  }

  get runtimeDeps(): { logger: ILogger; gateway: IMessageGateway } {
    return { logger: this.logger, gateway: this.gateway };
  }

  startAll() {
    for (const channel of this.channels) {
      if (!channel.enabled()) continue;
      this.logger.info(`Starting channel: ${channel.name}`);
      const stop = channel.start(this.logger, this.gateway);
      if (typeof stop === 'function') this.stopFnsByName.set(channel.name, stop);
    }
  }

  stopAll() {
    this.logger.info("\n👋 Shutting down gracefully...");
    this.stopFnsByName.forEach((stop) => stop());
    this.stopFnsByName.clear();
  }

  /**
   * Stops one channel (if it was started) and removes it from this manager
   * entirely — later `sendMessage`/`sendSticker`/`stopAll` calls won't see
   * it. Pairs with `PluginRegistry.extend`'s disposer: that removes a
   * channel's *declaration* from the registry before it's ever started;
   * this stops the *running instance* this manager already started,
   * clearing whatever socket/timer/listener its `stop()` holds.
   */
  stopChannel(name: string): void {
    const stop = this.stopFnsByName.get(name);
    if (stop) {
      stop();
      this.stopFnsByName.delete(name);
    }
    this.channels = this.channels.filter((channel) => channel.name !== name);
  }

  async sendMessage(channel: string, target: string, message: string): Promise<void> {
    const definition = this.resolveChannel(channel, 'sendMessage', 'outgoing messages');
    await definition.sendMessage(this.logger, target, message);
  }

  async sendSticker(channel: string, target: string, sticker: StickerReference): Promise<void> {
    const definition = this.resolveChannel(channel, 'sendSticker', 'sending stickers');
    await definition.sendSticker(this.logger, target, sticker);
  }

  private resolveChannel<K extends 'sendMessage' | 'sendSticker'>(
    channel: string,
    capability: K,
    capabilityLabel: string,
  ): ChannelDefinition & Required<Pick<ChannelDefinition, K>> {
    const definition = this.channels.find((current) => current.name === channel);

    if (!definition) {
      throw new Error(`Unknown channel: ${channel}`);
    }

    if (!definition.enabled()) {
      throw new Error(`Channel "${channel}" is not enabled.`);
    }

    if (!definition[capability]) {
      throw new Error(`Channel "${channel}" does not support ${capabilityLabel}.`);
    }

    return definition as ChannelDefinition & Required<Pick<ChannelDefinition, K>>;
  }
}

class ChannelsSingleton {
  private static instance: ChannelsManager;

  static getInstance(logger: ILogger, gateway: IMessageGateway, channels: ChannelDefinition[] = []): ChannelsManager {
    if (!ChannelsSingleton.instance) {
      const seen = new Set<string>();
      const duplicates = channels
        .map((c) => c.name)
        .filter((name) => (seen.has(name) ? true : (seen.add(name), false)));

      if (duplicates.length > 0) {
        throw new Error(
          `Duplicate channel names detected: ${[...new Set(duplicates)].join(', ')}. Each channel must have a unique name.`,
        );
      }

      ChannelsSingleton.instance = new ChannelsManager(logger, gateway, channels);
    }
    return ChannelsSingleton.instance;
  }

  static getExistingInstance(): ChannelsManager | null {
    return ChannelsSingleton.instance;
  }

  /**
   * `getInstance` only constructs on its first call — every later call
   * silently ignores its `channels` argument and returns the original
   * instance (see `core/src/channels/index.test.ts`, "ignores channels
   * passed to getInstance after the first construction"). Fine for the one
   * production call site (`core/src/app.ts`), but it means a Vitest suite
   * that wants a second scenario with different channels in the same
   * process needs an explicit reset. Mirrors the `_setBotUsernameForTesting`
   * pattern already used in the Telegram plugin.
   */
  static resetForTesting(): void {
    ChannelsSingleton.instance = undefined as unknown as ChannelsManager;
  }
}

export { ChannelsManager, ChannelsSingleton };
