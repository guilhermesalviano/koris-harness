import { config, reloadConfig } from '../../config';
import { loadCurrentOrExampleSettings, mergeSettingsPayload, writeSettingsFile } from '../../config/settings-writer';
import { extractHostname } from './gate';

export type AddAllowedDomainResult =
  | { ok: false; error: string }
  | { ok: true; added: boolean; hostname: string; allowedDomains: string[] };

/**
 * Adds a domain to koris.json `allowed_domains` and reloads config in place.
 * Idempotent — a domain already on the list returns `added: false`. Shared by
 * the dashboard endpoint and the `/allow` chat command.
 */
export function addAllowedDomain(input: string): AddAllowedDomainResult {
  const raw = input.trim();
  if (!raw) {
    return { ok: false, error: 'A domain is required.' };
  }

  const hostname = extractHostname(raw);
  if (!hostname) {
    return { ok: false, error: `"${raw}" is not a valid domain.` };
  }

  const current = config.ALLOWED_DOMAINS;
  if (current.includes(hostname)) {
    return { ok: true, added: false, hostname, allowedDomains: current };
  }

  const merged = mergeSettingsPayload(loadCurrentOrExampleSettings(), {
    allowed_domains: [...current, hostname],
  });
  writeSettingsFile(merged);
  reloadConfig();

  return { ok: true, added: true, hostname, allowedDomains: config.ALLOWED_DOMAINS };
}
