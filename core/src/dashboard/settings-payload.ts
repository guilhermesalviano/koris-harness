import { VALID_LOG_LEVELS, isValidUrl, isValidLogLevel, isSupportedProvider } from '../config/validators';
import { applyAiProviderPatch, applyAiRolePatch, applyAiEmbedPatch, mergeSettingsPayload } from '../config/settings-writer';
import type { AiRolePatch, AiEmbedPatch } from '../config/settings-writer';
import { isPlainObject } from '../../../plugins/config/merge';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function settingNumber(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return NaN;
  return Number(value);
}

/** Maps a snake_case per-role settings patch to an `AiRolePatch`. */
function toAiRolePatch(profile: Record<string, unknown>): AiRolePatch {
  const patch: AiRolePatch = { provider: String(profile.provider) };
  if (typeof profile.base_url === 'string') patch.base_url = profile.base_url;
  if (typeof profile.api_token === 'string') patch.api_token = profile.api_token;
  if (typeof profile.model === 'string') patch.model = profile.model;
  const numCtx = settingNumber(profile.num_ctx);
  if (Number.isFinite(numCtx)) patch.num_ctx = numCtx;
  return patch;
}

/** Maps a snake_case `ai.embed` settings patch to an `AiEmbedPatch`. */
function toAiEmbedPatch(profile: Record<string, unknown>): AiEmbedPatch {
  const patch: AiEmbedPatch = { provider: String(profile.provider) };
  if (typeof profile.enabled === 'boolean') patch.enabled = profile.enabled;
  if (typeof profile.model === 'string') patch.model = profile.model;
  if (typeof profile.base_url === 'string') patch.base_url = profile.base_url;
  if (typeof profile.api_token === 'string') patch.api_token = profile.api_token;
  return patch;
}

export function collectSettingsPayloadErrors(
  payload: Record<string, unknown>,
): string[] {
  const errors: string[] = [];

  for (const key of ['ai', 'skills', 'channels', 'personal_information']) {
    if (key in payload && !asRecord(payload[key])) errors.push(`${key} must be an object.`);
  }

  if ('web_port' in payload) {
    const port = settingNumber(payload.web_port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      errors.push('web_port must be an integer between 1 and 65535.');
    }
  }

  if ('log_level' in payload && (typeof payload.log_level !== 'string' || !isValidLogLevel(payload.log_level))) {
    errors.push(`log_level must be one of: ${VALID_LOG_LEVELS.join(', ')}.`);
  }

  if ('gateway_host' in payload && (typeof payload.gateway_host !== 'string' || (payload.gateway_host && !isValidUrl(payload.gateway_host)))) {
    errors.push('gateway_host must be a valid URL.');
  }

  const skills = asRecord(payload.skills);
  if (skills) {
    if (skills.mode !== undefined && skills.mode !== 'auto' && skills.mode !== 'manual') {
      errors.push('skills.mode must be "auto" or "manual".');
    }
    if (skills.limit !== undefined && skills.limit !== '') {
      const limit = settingNumber(skills.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        errors.push('skills.limit must be a positive integer.');
      }
    }
  }

  const ai = asRecord(payload.ai);
  if (ai) {
    // `ai.<role>` = save + activate for that role; `ai.provider` = save only.
    for (const key of ['manager', 'workers', 'provider'] as const) {
      const profile = asRecord(ai[key]);
      if (key in ai && !profile) errors.push(`ai.${key} must be an object.`);
      if (!profile) continue;
      const label = `ai.${key}`;

      for (const field of ['provider', 'base_url', 'api_token', 'model']) {
        if (field in profile && typeof profile[field] !== 'string') errors.push(`${label}.${field} must be a string.`);
      }

      if (typeof profile.provider === 'string' && profile.provider === 'mock') {
        errors.push(`${label}.provider "mock" is reserved for internal testing and cannot be set here.`);
      } else if (typeof profile.provider === 'string' && !isSupportedProvider(profile.provider)) {
        errors.push(`${label}.provider "${profile.provider}" is not supported.`);
      }
      if (typeof profile.base_url === 'string' && profile.base_url && !isValidUrl(profile.base_url)) {
        errors.push(`${label}.base_url must be a valid URL.`);
      }
      if (typeof profile.model === 'string' && !profile.model.trim()) {
        errors.push(`${label}.model must not be empty.`);
      }
      if (profile.num_ctx !== undefined && profile.num_ctx !== '') {
        const numCtx = settingNumber(profile.num_ctx);
        if (!Number.isInteger(numCtx) || numCtx < 512 || numCtx > 131072) {
          errors.push(`${label}.num_ctx must be an integer between 512 and 131072.`);
        }
      }
    }

    // `num_ctx` (and model) live on the shared `ai.providers[]` entry keyed by
    // provider name, so a manager + workers patch that names the same provider
    // with different context sizes would silently clobber one on save. Reject it
    // rather than lose the value.
    const managerProfile = asRecord(ai.manager);
    const workersProfile = asRecord(ai.workers);
    if (
      managerProfile
      && workersProfile
      && typeof managerProfile.provider === 'string'
      && managerProfile.provider === workersProfile.provider
      && managerProfile.num_ctx !== undefined && managerProfile.num_ctx !== ''
      && workersProfile.num_ctx !== undefined && workersProfile.num_ctx !== ''
      && Number(managerProfile.num_ctx) !== Number(workersProfile.num_ctx)
    ) {
      errors.push(
        `ai.manager and ai.workers both use provider "${managerProfile.provider}", whose num_ctx is shared. `
        + 'Set the same num_ctx for both roles, or point them at separate provider entries.',
      );
    }

    const embed = asRecord(ai.embed);
    if ('embed' in ai && !embed) errors.push('ai.embed must be an object.');
    if (embed) {
      const label = 'ai.embed';
      for (const field of ['provider', 'base_url', 'api_token', 'model']) {
        if (field in embed && typeof embed[field] !== 'string') errors.push(`${label}.${field} must be a string.`);
      }
      if ('enabled' in embed && typeof embed.enabled !== 'boolean') errors.push('ai.embed.enabled must be a boolean.');
      if (typeof embed.provider === 'string' && embed.provider === 'mock') {
        errors.push(`${label}.provider "mock" is reserved for internal testing and cannot be set here.`);
      } else if (typeof embed.provider === 'string' && !isSupportedProvider(embed.provider)) {
        errors.push(`${label}.provider "${embed.provider}" is not supported.`);
      }
      if (typeof embed.base_url === 'string' && embed.base_url && !isValidUrl(embed.base_url)) {
        errors.push(`${label}.base_url must be a valid URL.`);
      }
      if (embed.enabled !== false && typeof embed.model === 'string' && !embed.model.trim()) {
        errors.push(`${label}.model must not be empty when embeddings are enabled.`);
      }
    }
  }

  return errors;
}

/** Translate dashboard patches into persisted settings and per-channel configs. */
export function buildSettingsUpdate(
  current: Record<string, unknown>,
  rawPatch: Record<string, unknown>,
  channelNames: string[],
) {
  const channelsPatch = asRecord(rawPatch.channels);
  // Split `channels.*` into live-channel `config.yml` patches (any key that
  // matches a discovered live channel) and the rest, which stays in the
  // core settings file. No channel is named here.
  const liveNames = new Set(channelNames);
  const channelConfigPatches: { name: string; patch: Record<string, unknown> }[] = [];
  const coreChannelsPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(channelsPatch ?? {})) {
    const record = asRecord(value);
    if (liveNames.has(key) && record) {
      channelConfigPatches.push({ name: key, patch: record });
    } else {
      Object.defineProperty(coreChannelsPatch, key, {
        value, enumerable: true, configurable: true, writable: true,
      });
    }
  }
  const corePatch: Record<string, unknown> = { ...rawPatch };
  if (channelsPatch) {
    corePatch.channels = coreChannelsPatch;
  }

  // The web UI still sends provider changes as a per-role patch
  // (`{ ai: { manager: { provider, base_url, model, api_token } } }`).
  // Translate each role into an `ai.providers[]` upsert + `ai.roles`
  // repoint so previously-configured providers are preserved on disk.
  // `ai.<role>` patch = save the provider AND make it active for that role.
  // `ai.provider` patch = save the provider's config only (no role change).
  const aiPatch = asRecord(corePatch.ai);
  const rolePatches: { role: 'manager' | 'workers'; patch: AiRolePatch }[] = [];
  let providerOnlyPatch: AiRolePatch | undefined;
  let embedPatch: AiEmbedPatch | undefined;
  if (aiPatch) {
    const restAi: Record<string, unknown> = { ...aiPatch };
    for (const role of ['manager', 'workers'] as const) {
      const profile = asRecord(aiPatch[role]);
      if (!profile) continue;
      delete restAi[role];
      if (typeof profile.provider !== 'string' || !profile.provider.trim()) continue;
      rolePatches.push({ role, patch: toAiRolePatch(profile) });
    }
    const providerProfile = asRecord(aiPatch.provider);
    if (providerProfile && typeof providerProfile.provider === 'string' && providerProfile.provider.trim()) {
      delete restAi.provider;
      providerOnlyPatch = toAiRolePatch(providerProfile);
    }
    const embedProfile = asRecord(aiPatch.embed);
    if (embedProfile && typeof embedProfile.provider === 'string' && embedProfile.provider.trim()) {
      delete restAi.embed;
      embedPatch = toAiEmbedPatch(embedProfile);
    }
    corePatch.ai = restAi;
  }

  if (providerOnlyPatch) {
    current = applyAiProviderPatch(current, providerOnlyPatch);
  }
  for (const { role, patch: rolePatch } of rolePatches) {
    current = applyAiRolePatch(current, role, rolePatch);
  }
  if (embedPatch) {
    current = applyAiEmbedPatch(current, embedPatch);
  }
  const merged = mergeSettingsPayload(current, corePatch);
  const personalInformation = asRecord(corePatch.personal_information);
  if (personalInformation) merged.personal_information = personalInformation;
  return { settings: merged, channelConfigPatches };
}
