import { getSupportedProviders, resolveProviderBaseUrl } from '../services/providers';

export const VALID_LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'] as const;
export type LogLevel = (typeof VALID_LOG_LEVELS)[number];

export function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function isValidLogLevel(value: string): value is LogLevel {
  return (VALID_LOG_LEVELS as readonly string[]).includes(value);
}

export function isSupportedProvider(value: string): boolean {
  return (getSupportedProviders() as readonly string[]).includes(value);
}

export interface HttpGetResult {
  ok: boolean;
  status?: number;
  body?: string;
  error?: string;
}

export async function httpGet(
  url: string,
  timeoutMs = 5000,
  headers?: Record<string, string>,
): Promise<HttpGetResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    const body = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export interface AiProviderConnectivityProfile {
  label: string;
  provider: string;
  baseUrl: string;
  apiToken: string;
}

export interface AiProviderConnectivityResult {
  ok: boolean;
  skipped?: boolean;
  detail?: string;
  error?: string;
  authFailed?: boolean;
  status?: number;
  healthUrl?: string;
}

export async function checkAiProviderConnectivity(
  profile: AiProviderConnectivityProfile,
  timeoutMs = 5000,
): Promise<AiProviderConnectivityResult> {
  if (profile.provider === 'mock') {
    return { ok: true, skipped: true };
  }

  const baseUrl = resolveProviderBaseUrl(profile.provider, profile.baseUrl).replace(/\/+$/, '');
  if (!baseUrl) {
    return { ok: false, error: `no base URL configured for provider "${profile.provider}"` };
  }

  const healthUrl = profile.provider === 'ollama'
    ? `${baseUrl}/api/version`
    : `${baseUrl}/models`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (profile.provider !== 'ollama' && profile.apiToken) headers['Authorization'] = `Bearer ${profile.apiToken}`;

  const result = await httpGet(healthUrl, timeoutMs, headers);

  if (result.ok) {
    let detail: string | undefined;
    if (profile.provider === 'ollama') {
      try {
        detail = (JSON.parse(result.body ?? '{}') as { version?: string }).version;
      } catch {
        /* ignore */
      }
    }
    return { ok: true, detail, healthUrl };
  }

  if (result.error) {
    return { ok: false, error: result.error, healthUrl };
  }

  if (result.status === 401 || result.status === 403) {
    return { ok: false, authFailed: true, status: result.status, healthUrl };
  }

  return { ok: false, status: result.status, healthUrl };
}