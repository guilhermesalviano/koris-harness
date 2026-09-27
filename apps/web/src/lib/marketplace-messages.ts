import type { MarketplaceItem } from './types';

/**
 * Copy shown after a successful pull from koris-hub.
 *
 * The families differ in what happens next, and blurring that is how a pulled
 * channel ends up looking broken. A channel is deliberately left INACTIVE:
 * `defaultPluginEnabled` (core) returns `false` for the `channels` family, and
 * the hub catalog marks every channel `defaultEnabled: false`, because a channel
 * cannot do anything useful until its own configuration exists — a whitelist, a
 * bot token, a paired device. Telling the user it is "active within a few
 * seconds" would be a lie they'd debug for an hour.
 */
export function pullSuccessMessage(family: MarketplaceItem['family'], label: string): string {
  if (family === 'channel') {
    return `Pulled "${label}" — installed but inactive. Finish its configuration in Channels, then activate it.`;
  }
  if (family === 'mcp') {
    return `Pulled "${label}" — enabled. If it doesn't connect, set its URL in Plugins.`;
  }
  return `Pulled "${label}" — active within a few seconds, no restart needed.`;
}

/** Same point, for the setup wizard's per-channel Download button. */
export function channelDownloadedMessage(name: string): string {
  return `${name} downloaded — inactive until you finish the configuration below, then click Activate.`;
}
