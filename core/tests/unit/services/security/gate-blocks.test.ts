import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/config', () => ({ config: { ALLOWED_DOMAINS: [] } }));

import { findGateBlocks, formatGateBlockNotice } from '../../../../src/services/security/gate-blocks';

function row(overrides: Record<string, unknown>) {
  return {
    id: 'a',
    type: 'tool',
    role: 'worker',
    tool_calls: 0,
    duration_ms: 1,
    status: 'error',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('findGateBlocks', () => {
  it('returns [] and does not query when no scope is given', () => {
    const repo = { findAll: vi.fn() };
    expect(findGateBlocks(repo, { allowed: [] })).toEqual([]);
    expect(repo.findAll).not.toHaveBeenCalled();
  });

  it('extracts blocked domains from gate-error rows, skipping allowed, dupes and unrelated errors', () => {
    const repo = {
      findAll: vi.fn().mockReturnValue([
        row({ error_message: 'Domain gate: "api.evil.com" is not in allowed_domains. x', tool_name: 'curl_request' }),
        row({ error_message: 'Domain gate: "api.evil.com" is not in allowed_domains. x' }),
        row({ error_message: 'Domain gate: "ok.com" is not in allowed_domains. x' }),
        row({ error_message: 'Request timeout after 30 seconds' }),
      ]),
    };

    const blocks = findGateBlocks(repo, { runId: 'r1', allowed: ['ok.com'] });

    expect(blocks).toEqual([{ domain: 'api.evil.com', toolName: 'curl_request', at: '2026-01-01T00:00:00Z' }]);
    expect(repo.findAll).toHaveBeenCalledWith({
      limit: 25,
      offset: 0,
      filters: { type: 'tool', status: 'error', runId: 'r1' },
    });
  });

  it('falls back to the tool_args url when the gate message names no host', () => {
    const repo = {
      findAll: vi.fn().mockReturnValue([
        row({
          error_message: 'Domain gate: no allowed_domains configured in koris.json — curl requests are blocked.',
          tool_args: JSON.stringify({ url: 'https://fresh.example.org/path' }),
        }),
      ]),
    };

    const blocks = findGateBlocks(repo, { sessionId: 's1', allowed: [] });

    expect(blocks.map((b) => b.domain)).toEqual(['fresh.example.org']);
  });
});

describe('formatGateBlockNotice', () => {
  it('is empty for no blocks', () => {
    expect(formatGateBlockNotice([])).toBe('');
  });

  it('names the domain and the /allow command for a single block', () => {
    const text = formatGateBlockNotice([{ domain: 'api.evil.com', toolName: null, at: 'x' }]);
    expect(text).toContain('api.evil.com');
    expect(text).toContain('/allow api.evil.com');
  });

  it('lists every domain for multiple blocks', () => {
    const text = formatGateBlockNotice([
      { domain: 'a.com', toolName: null, at: 'x' },
      { domain: 'b.com', toolName: null, at: 'x' },
    ]);
    expect(text).toContain('/allow a.com');
    expect(text).toContain('/allow b.com');
  });
});
