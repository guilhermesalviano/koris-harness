import type { ProviderRole } from './types';

export type ProviderEditRole = ProviderRole | 'embed';

export type ProviderDraft = {
  provider: string;
  model: string;
  apiToken: string;
  baseUrl: string;
  numCtx: string;
  enabled: boolean;
};

export function validateProviderDraft(value: ProviderDraft, embed: boolean): string | null {
  if (!value.provider) return 'Choose a provider.';
  if ((!embed || value.enabled) && !value.model.trim()) return 'Enter a model to activate this provider.';
  if (value.baseUrl.trim()) {
    try {
      const url = new URL(value.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return 'Use an HTTP or HTTPS base URL.';
    } catch { return 'Enter a valid base URL.'; }
  }
  if (!embed && value.numCtx.trim()) {
    const size = Number(value.numCtx);
    if (!Number.isInteger(size) || size < 512 || size > 131072) return 'Context size must be a whole number between 512 and 131072.';
  }
  return null;
}

export function buildProviderEditPatch(role: ProviderEditRole, value: ProviderDraft, baseline?: ProviderDraft) {
  const switched = value.provider !== baseline?.provider;
  const profile: Record<string, unknown> = { provider: value.provider };
  if (switched || value.model !== baseline?.model) profile.model = value.model.trim();
  if (switched || value.baseUrl !== baseline?.baseUrl) profile.base_url = value.baseUrl.trim();
  if (value.apiToken && (switched || value.apiToken !== baseline?.apiToken)) profile.api_token = value.apiToken;
  if (role === 'embed') {
    if (switched || value.enabled !== baseline?.enabled) profile.enabled = value.enabled;
  } else if (value.numCtx.trim() && (switched || value.numCtx !== baseline?.numCtx)) {
    profile.num_ctx = Number(value.numCtx);
  }
  return { ai: { [role]: profile } };
}
