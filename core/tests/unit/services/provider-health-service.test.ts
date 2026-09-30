import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockProviderHealthCheck } = vi.hoisted(() => ({
  mockProviderHealthCheck: vi.fn(),
}));

vi.mock('../../../src/services/providers', () => ({
  getAIProvider: vi.fn().mockReturnValue({ healthCheck: mockProviderHealthCheck }),
}));

import { healthCheck } from '../../../src/services/provider-health-service';
import { getAIProvider } from '../../../src/services/providers';
import type { ILogger } from '../../../src/infrastructure/logger';

const logger: ILogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
};

describe('healthCheck', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns status ok when provider reports healthy', async () => {
    mockProviderHealthCheck.mockResolvedValue({ ok: true, detail: 'v0.5.0' });
    const result = await healthCheck(logger);
    expect(result.status).toBe('ok');
    expect(result.details).toBe('v0.5.0');
  });

  it('reports invalid provider configuration as an unhealthy result', async () => {
    vi.mocked(getAIProvider).mockImplementationOnce(() => { throw new Error('Invalid provider URL'); });
    expect(await healthCheck(logger)).toMatchObject({ status: 'error', details: 'Invalid provider URL' });
  });

  it('preserves provider diagnostics when a health check fails', async () => {
    mockProviderHealthCheck.mockResolvedValue({ ok: false, detail: 'HTTP 503' });
    expect(await healthCheck(logger)).toMatchObject({ status: 'error', details: 'HTTP 503' });
  });

  it('returns a valid ISO timestamp', async () => {
    mockProviderHealthCheck.mockResolvedValue({ ok: true });
    const result = await healthCheck(logger);
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns status error when provider reports ok: false', async () => {
    mockProviderHealthCheck.mockResolvedValue({ ok: false });
    const result = await healthCheck(logger);
    expect(result.status).toBe('error');
  });

  it('returns status error when provider throws', async () => {
    mockProviderHealthCheck.mockRejectedValue(new Error('connection refused'));
    const result = await healthCheck(logger);
    expect(result.status).toBe('error');
  });

  it('includes error message in details when provider throws', async () => {
    mockProviderHealthCheck.mockRejectedValue(new Error('connection refused'));
    const result = await healthCheck(logger);
    expect(result.details).toBe('connection refused');
  });

  it('handles non-Error throws', async () => {
    mockProviderHealthCheck.mockRejectedValue('timeout');
    const result = await healthCheck(logger);
    expect(result.status).toBe('error');
    expect(result.details).toBe('timeout');
  });
});
