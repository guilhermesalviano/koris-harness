import { deepGet, loadConfigFile } from './helpers';

export interface ChannelOverride {
  enabled?: boolean;
}

/**
 * Optional `channels.overrides` array in koris.json:
 *   { "channels": { "overrides": [{ "id": "telegram", "enabled": false }] } }
 * (kept nested under a `channels` object rather than a top-level `channels`
 * array so the key can grow other channel-scoped settings later without a
 * breaking shape change.)
 *
 * This is a thin, additive override on top of each channel's DB-backed
 * enablement (`core/src/services/plugins/plugin-enablement.ts`) — not a
 * replacement for it. It can only flip `enabled` on a channel that already
 * registers a `ChannelDefinition` (every channel plugin's `create()` always
 * registers one now); it cannot supply a token/authFolder a plugin needs to
 * function, so a channel with no token still won't actually start even if
 * overridden to `enabled: true` — see `createTelegramAdapter`'s `enabled()`,
 * which also requires a non-empty token. Anything on an entry besides
 * `id`/`enabled` is ignored, not partially applied.
 */
export function loadChannelOverrides(options?: { cwd?: string; dirname?: string }): Record<string, ChannelOverride> {
  const fileConfig = loadConfigFile({ cwd: options?.cwd, dirname: options?.dirname });
  const raw = deepGet(fileConfig, 'channels.overrides');
  if (!Array.isArray(raw)) {
    return {};
  }

  const overrides: Record<string, ChannelOverride> = {};
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;

    const id = (entry as Record<string, unknown>).id;
    if (typeof id !== 'string' || !id) continue;

    const enabled = (entry as Record<string, unknown>).enabled;
    if (typeof enabled === 'boolean') {
      overrides[id] = { enabled };
    }
  }

  return overrides;
}
