import path from 'node:path';
import { ChannelHandlerFactory } from '../channels';
import { config } from '../config';
import type { ILogger } from '../infrastructure/logger';
import type { IMessageGateway } from '../services/agents/message-gateway';
import { listLiveChannels } from '../../../plugins/channels';
import type { LiveChannelDescriptor } from '../../../plugins/channels/contracts';

/**
 * Live channel control for the setup wizard / admin panel: start a channel,
 * reprime its runtime state after a config save, and read/write its
 * `config.yml` — all without a process restart.
 *
 * Channel-agnostic: the set of channels is discovered at load time by scanning
 * `plugins/channels/*` for a `liveChannel` descriptor (see `listLiveChannels`).
 * Nothing here names a specific channel, so adding one needs no change to this
 * file. A name that isn't a discovered live channel is a safe no-op everywhere.
 */
let descriptorCache: Map<string, LiveChannelDescriptor> | null = null;

/** Clears the cached channel descriptors so newly installed/pulled channels are discovered. */
export function reprimeLiveChannelDescriptors(): void {
  descriptorCache = null;
}

/** Discovered lazily so merely importing this module (common across the
 *  dashboard) doesn't walk `plugins/channels/` until a live-channel action
 *  actually needs it. */
function descriptors(): Map<string, LiveChannelDescriptor> {
  if (!descriptorCache) {
    const channelsDir = path.join(config.BASE_DIR, 'plugins', 'channels');
    descriptorCache = new Map(listLiveChannels({ directory: channelsDir }).map((descriptor) => [descriptor.name, descriptor]));
  }
  return descriptorCache;
}

const stopFns = new Map<string, () => void>();
const starting = new Set<string>();

/** Names of every channel that can be brought up live. */
export function liveChannelNames(): string[] {
  return [...descriptors().keys()];
}

/**
 * Starts a channel live (or no-ops if it's already connecting/connected, or not
 * a discovered live channel), so the setup wizard / admin panel can bring it up
 * after saving its config without a process restart.
 */
export function startChannelLive(name: string, logger: ILogger, gateway: IMessageGateway): void {
  const descriptor = descriptors().get(name);
  if (!descriptor || stopFns.has(name) || starting.has(name)) return;
  starting.add(name);

  descriptor
    .start({ channelHandler: ChannelHandlerFactory, gateway, logger })
    .then(({ stop }) => {
      stopFns.set(name, stop);
    })
    .catch((err: Error) => {
      logger.warn(`Failed to start ${name} live: ${err.message}`);
    })
    .finally(() => {
      starting.delete(name);
    });
}

export function isChannelLiveStarted(name: string): boolean {
  return stopFns.has(name);
}

/**
 * Re-reads a channel's `config.yml` into its module-level runtime state
 * (whitelist, `allow_unlisted_senders`, …) without touching its socket, so a
 * channel settings save from the web UI takes effect without a restart. A
 * no-op for an unknown channel; harmless when the channel isn't running — it
 * only refreshes state the message handler reads.
 */
export function reprimeChannelRuntime(name: string): void {
  descriptors().get(name)?.configureRuntime({ channelHandler: ChannelHandlerFactory });
}

/** A channel plugin's `config.yml` as a plain record, or `undefined` if the
 *  name isn't a discovered live channel. */
export function loadChannelConfig(name: string): Record<string, unknown> | undefined {
  return descriptors().get(name)?.loadConfig();
}

/** Apply a partial `config.yml` patch to a channel plugin. No-op for an
 *  unknown channel. */
export function writeChannelConfigPatch(name: string, patch: Record<string, unknown>): void {
  descriptors().get(name)?.writeConfigPatch(patch);
}
