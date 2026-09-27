/**
 * AI provider config shape + resolution.
 *
 * `koris.json` keeps every configured provider in `ai.providers[]` (each with
 * its own credentials, context size, and a single `model` name) and points
 * each role at one of them through `ai.roles`. Embeddings have their own
 * pointer (`ai.embed`), not a per-role setting:
 *
 *   "ai": {
 *     "providers": [
 *       { "provider": "ollama", "base_url": "…", "api_token": "", "num_ctx": 32768,
 *         "model": "gemma4:e4b" },
 *       { "provider": "openai", "base_url": "", "api_token": "sk-…", "model": "gpt-4o-mini" }
 *     ],
 *     "roles": {
 *       "manager": { "provider": "ollama" },
 *       "workers": { "provider": "openai" }
 *     },
 *     "embed": { "enabled": false, "provider": "ollama", "model": "nomic-embed-text" }
 *   }
 *
 * This is the only shape understood — there is no auto-migration from older
 * layouts. Regenerate the file from `koris.example.json` if it drifts.
 */

/** Default context size when a provider entry has no `num_ctx`. */
export const DEFAULT_NUM_CTX = 16384;

export interface ResolvedRoleProfile {
  PROVIDER: string;
  BASE_URL: string;
  API_TOKEN: string;
  MODEL: string;
  NUM_CTX: number;
}

// Kept as an alias so existing imports/type references still compile — every
// role now carries NUM_CTX.
export type ResolvedWorkersProfile = ResolvedRoleProfile;

export interface ResolvedEmbedProfile {
  ENABLED: boolean;
  PROVIDER: string;
  BASE_URL: string;
  API_TOKEN: string;
  MODEL: string;
}

export interface ResolvedAiRoles {
  MANAGER: ResolvedRoleProfile;
  WORKERS: ResolvedWorkersProfile;
  EMBED: ResolvedEmbedProfile;
}

export interface AiProviderPatch {
  provider: string;
  base_url?: string;
  api_token?: string;
  /** The provider entry's single model. */
  model?: string;
  /** Context window for this provider (stored on the provider entry). */
  num_ctx?: number;
}

// A role patch carries exactly the same fields as a provider patch (the model
// lands on the provider entry, the role pointer only stores `{ provider }`).
export type AiRolePatch = AiProviderPatch;

export interface AiEmbedPatch {
  enabled?: boolean;
  provider: string;
  model?: string;
  base_url?: string;
  api_token?: string;
}

/** Hard-coded fallbacks — mirror the historical defaults in config/index.ts. */
const DEFAULT_MANAGER: ResolvedRoleProfile = {
  PROVIDER: 'ollama',
  BASE_URL: '',
  API_TOKEN: '',
  MODEL: 'gemma4:e2b',
  NUM_CTX: DEFAULT_NUM_CTX,
};

const DEFAULT_WORKERS: ResolvedWorkersProfile = {
  PROVIDER: 'ollama',
  BASE_URL: '',
  API_TOKEN: '',
  MODEL: 'qwen:3.5:2b',
  NUM_CTX: DEFAULT_NUM_CTX,
};

const DEFAULT_EMBED_PROVIDER = 'ollama';
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getOrCreateRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = obj[key];
  if (isRecord(existing)) return existing;
  const created: Record<string, unknown> = {};
  obj[key] = created;
  return created;
}

function strOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function numOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return fallback;
  return String(value) === 'true';
}

function findEntry(
  providers: Record<string, unknown>[],
  name: string,
): Record<string, unknown> | undefined {
  return providers.find((p) => isRecord(p) && p.provider === name);
}

function providerList(ai: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(ai.providers)
    ? (ai.providers as unknown[]).filter(isRecord)
    : [];
}

function resolveRole(
  pointer: unknown,
  providers: Record<string, unknown>[],
  fallback: ResolvedRoleProfile,
): ResolvedRoleProfile {
  const ptr = isRecord(pointer) ? pointer : {};
  const providerName = strOr(ptr.provider, fallback.PROVIDER);
  const entry = findEntry(providers, providerName);
  return {
    PROVIDER: providerName,
    BASE_URL: entry ? strOr(entry.base_url, fallback.BASE_URL) : fallback.BASE_URL,
    API_TOKEN: entry ? strOr(entry.api_token, fallback.API_TOKEN) : fallback.API_TOKEN,
    // The model comes from the provider entry, not the role pointer.
    MODEL: strOr(entry?.model, fallback.MODEL),
    // Context size lives on the provider entry (coerces a stringy num_ctx).
    NUM_CTX: numOr(entry?.num_ctx, fallback.NUM_CTX),
  };
}

/**
 * Resolves the embeddings profile from the `ai.embed` pointer. base_url /
 * api_token are joined from the matching `ai.providers[]` entry.
 */
export function resolveEmbed(aiRaw: unknown): ResolvedEmbedProfile {
  const ai = isRecord(aiRaw) ? aiRaw : {};
  const providers = providerList(ai);
  const embed = isRecord(ai.embed) ? ai.embed : {};

  const providerName = strOr(embed.provider, DEFAULT_EMBED_PROVIDER);
  const entry = findEntry(providers, providerName);

  return {
    ENABLED: boolOr(embed.enabled, false),
    PROVIDER: providerName,
    BASE_URL: entry ? strOr(entry.base_url, '') : '',
    API_TOKEN: entry ? strOr(entry.api_token, '') : '',
    MODEL: strOr(embed.model, DEFAULT_EMBED_MODEL),
  };
}

/**
 * Resolves `config.AI.MANAGER` / `config.AI.WORKERS` / `config.AI.EMBED` from
 * the raw `ai` block of koris.json. Pure: no env access, that layering stays in
 * config/index.ts.
 */
export function resolveAiRoles(aiRaw: unknown): ResolvedAiRoles {
  const ai = isRecord(aiRaw) ? aiRaw : {};
  const providers = providerList(ai);
  const roles = isRecord(ai.roles) ? ai.roles : {};

  const manager = resolveRole(roles.manager, providers, DEFAULT_MANAGER);
  const workers = resolveRole(roles.workers, providers, DEFAULT_WORKERS);

  return {
    MANAGER: manager,
    WORKERS: workers,
    EMBED: resolveEmbed(ai),
  };
}

/**
 * Adds or updates a provider entry in `ai.providers[]` in place. Credentials
 * are only overwritten when the patch supplies a non-empty value (so a blank
 * token from the UI keeps the stored one); `num_ctx`, when given, is stored on
 * the entry; the entry keeps a single `model` string, overwritten when the
 * patch supplies a non-empty one. Mutates `ai`.
 */
export function upsertAiProvider(ai: Record<string, unknown>, patch: AiProviderPatch): void {
  const providers = Array.isArray(ai.providers)
    ? (ai.providers as Record<string, unknown>[])
    : [];
  ai.providers = providers;

  let entry = providers.find((p) => isRecord(p) && p.provider === patch.provider);
  if (!entry) {
    entry = { provider: patch.provider, base_url: '', api_token: '', model: '' };
    providers.push(entry);
  }
  if (typeof entry.base_url !== 'string') entry.base_url = '';
  if (typeof entry.api_token !== 'string') entry.api_token = '';
  if (typeof entry.model !== 'string') entry.model = '';

  if (typeof patch.base_url === 'string' && patch.base_url.trim()) {
    entry.base_url = patch.base_url;
  }
  if (typeof patch.api_token === 'string' && patch.api_token.trim()) {
    entry.api_token = patch.api_token;
  }
  if (typeof patch.num_ctx === 'number' && Number.isFinite(patch.num_ctx)) {
    entry.num_ctx = patch.num_ctx;
  }
  if (typeof patch.model === 'string' && patch.model.trim()) {
    entry.model = patch.model;
  }
}

/**
 * Returns a copy of `base` with `patch` upserted into `ai.providers[]` (every
 * other provider and both role pointers left intact). Use this to save a
 * provider's config without making it the active provider for any role.
 */
export function applyAiProviderPatch(
  base: Record<string, unknown>,
  patch: AiProviderPatch,
): Record<string, unknown> {
  const next = structuredClone(base);
  const ai = getOrCreateRecord(next, 'ai');
  upsertAiProvider(ai, patch);
  return next;
}

/**
 * Returns a copy of `base` with the given role repointed at `patch.provider`
 * and the provider upserted into `ai.providers[]` (every other provider left
 * intact, the chosen model landing on the entry). The role pointer is written
 * as `{ provider }` only — the model is resolved from the provider entry.
 */
export function applyAiRolePatch(
  base: Record<string, unknown>,
  role: 'manager' | 'workers',
  patch: AiRolePatch,
): Record<string, unknown> {
  const next = structuredClone(base);
  const ai = getOrCreateRecord(next, 'ai');
  upsertAiProvider(ai, patch);

  const roles = getOrCreateRecord(ai, 'roles');
  roles[role] = { provider: patch.provider };

  return next;
}

/**
 * Returns a copy of `base` with the `ai.embed` pointer set to
 * `{ enabled, provider, model }`. The provider's credentials are upserted into
 * `ai.providers[]` (base_url / api_token reused from / written onto the
 * matching entry — the embed model is NOT written onto the entry since it can
 * differ from that provider's chat model).
 */
export function applyAiEmbedPatch(
  base: Record<string, unknown>,
  patch: AiEmbedPatch,
): Record<string, unknown> {
  const next = structuredClone(base);
  const ai = getOrCreateRecord(next, 'ai');

  // Ensure the provider entry exists and carries the creds, but never write the
  // embed model onto it (a shared provider keeps its own chat `model`).
  upsertAiProvider(ai, {
    provider: patch.provider,
    base_url: patch.base_url,
    api_token: patch.api_token,
  });

  const existing = isRecord(ai.embed) ? ai.embed : {};
  ai.embed = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : boolOr(existing.enabled, false),
    provider: patch.provider,
    model: typeof patch.model === 'string' && patch.model.trim()
      ? patch.model
      : strOr(existing.model, DEFAULT_EMBED_MODEL),
  };

  return next;
}
