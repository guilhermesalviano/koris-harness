import { config } from '../config';
import type { IPluginSettingsRepository } from '../repositories/plugin-settings';
import { resolvePluginEnabled } from '../services/plugins/plugin-enablement';
import { loadChannelConfig } from './live-channel-runtime';

/**
 * Reassembles the `CHANNELS.WHATSAPP` shape the frontend expects,
 * sourcing every field (including the per-channel `ALLOW_UNLISTED_SENDERS`
 * policy) from each plugin's own config.yml.
 */
export function buildChannelsSnapshot(pluginSettingsRepo: Pick<IPluginSettingsRepository, 'getEnabled'>) {
  const whatsapp = (loadChannelConfig('whatsapp') ?? {}) as {
    authFolder?: string;
    whitelist?: string;
    allowUnlistedSenders?: boolean;
  };
  return {
    WHATSAPP: {
      ENABLED: resolvePluginEnabled(pluginSettingsRepo, 'channels', 'whatsapp'),
      AUTH_FOLDER: whatsapp.authFolder ?? '',
      WHITELIST: whatsapp.whitelist ?? '',
      ALLOW_UNLISTED_SENDERS: whatsapp.allowUnlistedSenders ?? false,
    },
  };
}

export function buildSettingsResponse(pluginSettingsRepo: Pick<IPluginSettingsRepository, 'getEnabled'>): Record<string, unknown> {
  return { ...config, CHANNELS: buildChannelsSnapshot(pluginSettingsRepo) };
}
