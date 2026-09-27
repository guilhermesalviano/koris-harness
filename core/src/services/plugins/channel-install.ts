import { ChannelsSingleton } from '../../channels';
import { reprimeLiveChannelDescriptors } from '../../dashboard/live-channel-runtime';
import type { IPluginSettingsRepository } from '../../repositories/plugin-settings';
import { PluginCatalogSingleton } from './plugin-catalog-singleton';

/**
 * Registers a channel just pulled from koris-hub, and forces it INACTIVE.
 *
 * Downloading a channel must never turn it on: it can't work before its own
 * configuration exists (whitelist, bot token, paired device), so a channel that
 * activates on download just looks broken. `defaultPluginEnabled` already
 * answers "off" for a channel with no `plugin_settings` row, but relying on
 * that is the bug — a re-pull, or a pull of a channel someone enabled earlier
 * and then removed from disk, inherits the stale `enabled = 1` row and comes
 * back live. So the row is written explicitly every time, and any still-running
 * instance of the bundle being replaced is stopped (a no-op on a first pull,
 * where the channel was never in the manager).
 *
 * The user turns it on afterwards — `/channels enable <slug>`, the wizard's
 * Activate button, or the Plugins panel toggle.
 */
export function registerPulledChannel(slug: string, repo: IPluginSettingsRepository): void {
  reprimeLiveChannelDescriptors();
  PluginCatalogSingleton.append([{ family: 'channels', name: slug }]);
  repo.setEnabled('channels', slug, false);
  ChannelsSingleton.getExistingInstance()?.stopChannel(slug);
}
