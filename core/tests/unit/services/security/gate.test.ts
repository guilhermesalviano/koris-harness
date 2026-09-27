/**
 * Tests for the internal curl_request domain gate helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── config mock (must come before importing the gate) ───────────────────────

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { ALLOWED_DOMAINS: ['mac.local', 'example.com'] },
}));

vi.mock('../../../../src/config', () => ({ config: mockConfig }));

// ── imports (after mocks) ───────────────────────────────────────────────────

import {
  blockedHostnameFromGateError,
  extractHostname,
  gateErrorForUrl,
  getAllowedDomains,
  isDomainGateError,
} from '../../../../src/services/security/gate';

describe('extractHostname', () => {
  it('extracts the hostname from a full URL', () => {
    expect(extractHostname('https://mac.local/api/todo')).toBe('mac.local');
  });

  it('extracts the hostname from a bare domain', () => {
    expect(extractHostname('mac.local')).toBe('mac.local');
  });

  it('extracts the hostname from a bare domain with a port', () => {
    expect(extractHostname('mac.local:3000')).toBe('mac.local');
  });

  it('lowercases the hostname', () => {
    expect(extractHostname('https://MAC.LOCAL/path')).toBe('mac.local');
  });

  it('ignores scheme case when detecting an existing protocol', () => {
    expect(extractHostname('HTTP://mac.local/x')).toBe('mac.local');
  });

  it('returns null for an unparseable input', () => {
    expect(extractHostname('not a url at all!!')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractHostname('')).toBeNull();
  });

  it('returns null for a hostname with invalid characters', () => {
    expect(extractHostname('!!')).toBeNull();
  });
});

describe('gateErrorForUrl', () => {
  beforeEach(() => {
    mockConfig.ALLOWED_DOMAINS = ['mac.local', 'example.com'];
  });

  it('returns null when the hostname is allowlisted', () => {
    expect(gateErrorForUrl('https://mac.local/api/todo')).toBeNull();
  });

  it('returns an error listing the allowed domains for a disallowed hostname', () => {
    const error = gateErrorForUrl('https://evil.com');
    expect(error).toContain('Domain gate');
    expect(error).toContain('evil.com');
    expect(error).toContain('mac.local, example.com');
  });

  it('returns an explicit error when no allowlist is configured', () => {
    mockConfig.ALLOWED_DOMAINS = [];
    const error = gateErrorForUrl('https://mac.local/api');
    expect(error).toContain('no allowed_domains configured');
  });

  it('returns an error for an unparseable input', () => {
    expect(gateErrorForUrl('!!')).toContain('unable to resolve a hostname');
  });
});

describe('getAllowedDomains', () => {
  it('returns the configured allowlist', () => {
    mockConfig.ALLOWED_DOMAINS = ['a.local', 'b.local'];
    expect(getAllowedDomains()).toEqual(['a.local', 'b.local']);
  });
});

describe('isDomainGateError', () => {
  it('is true for a domain gate error string', () => {
    mockConfig.ALLOWED_DOMAINS = ['example.com'];
    expect(isDomainGateError(gateErrorForUrl('https://evil.com'))).toBe(true);
  });

  it('is false for unrelated messages and nullish input', () => {
    expect(isDomainGateError('Request timeout after 30 seconds')).toBe(false);
    expect(isDomainGateError(null)).toBe(false);
    expect(isDomainGateError(undefined)).toBe(false);
  });
});

describe('blockedHostnameFromGateError', () => {
  it('extracts the blocked hostname from a "not in allowed_domains" message', () => {
    mockConfig.ALLOWED_DOMAINS = ['example.com'];
    const error = gateErrorForUrl('https://api.evil.com/x') as string;
    expect(blockedHostnameFromGateError(error)).toBe('api.evil.com');
  });

  it('returns null for the empty-allowlist message (names no host)', () => {
    mockConfig.ALLOWED_DOMAINS = [];
    const error = gateErrorForUrl('https://mac.local/api') as string;
    expect(blockedHostnameFromGateError(error)).toBeNull();
  });
});
