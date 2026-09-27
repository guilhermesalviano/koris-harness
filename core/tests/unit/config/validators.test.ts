import { describe, expect, it } from 'vitest';

import {
  isValidUrl,
  isValidLogLevel,
  isSupportedProvider,
  checkAiProviderConnectivity,
} from '../../../src/config/validators';

describe('config/validators', () => {
  it('validates URLs', () => {
    expect(isValidUrl('http://localhost:11434')).toBe(true);
    expect(isValidUrl('not-a-url')).toBe(false);
  });

  it('validates log levels', () => {
    expect(isValidLogLevel('debug')).toBe(true);
    expect(isValidLogLevel('verbose')).toBe(true);
    expect(isValidLogLevel('nonsense')).toBe(false);
  });

  it('validates supported providers against the real provider registry', () => {
    expect(isSupportedProvider('mock')).toBe(true);
    expect(isSupportedProvider('ollama')).toBe(true);
    expect(isSupportedProvider('nvidia')).toBe(true);
    expect(isSupportedProvider('anthropic')).toBe(false);
    expect(isSupportedProvider('discord')).toBe(false);
  });

  it('skips connectivity checks for the mock provider', async () => {
    const result = await checkAiProviderConnectivity({
      label: 'manager',
      provider: 'mock',
      baseUrl: 'http://localhost:11434',
      apiToken: '',
    });

    expect(result).toEqual({ ok: true, skipped: true });
  });

  it('reports an error result when the provider is unreachable', async () => {
    const result = await checkAiProviderConnectivity(
      { label: 'manager', provider: 'ollama', baseUrl: 'http://127.0.0.1:1', apiToken: '' },
      500,
    );

    expect(result.ok).toBe(false);
  });

  it('checks ollama version on successful connectivity', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ version: '0.1.30' }),
    } as Response);

    const result = await checkAiProviderConnectivity({
      label: 'manager',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      apiToken: '',
    });

    expect(result.ok).toBe(true);
    expect(result.detail).toBe('0.1.30');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:11434/api/version',
      expect.objectContaining({ headers: { 'content-type': 'application/json' } }),
    );
    fetchSpy.mockRestore();
  });

  it('handles ollama response when body is not valid json', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'not-json',
    } as Response);

    const result = await checkAiProviderConnectivity({
      label: 'manager',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      apiToken: '',
    });

    expect(result.ok).toBe(true);
    expect(result.detail).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it('detects authentication failure on 401 or 403', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' } as Response)
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Forbidden' } as Response);

    const res401 = await checkAiProviderConnectivity({
      label: 'manager',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiToken: 'bad-token',
    });
    expect(res401).toMatchObject({ ok: false, authFailed: true, status: 401 });

    const res403 = await checkAiProviderConnectivity({
      label: 'manager',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiToken: 'forbidden-token',
    });
    expect(res403).toMatchObject({ ok: false, authFailed: true, status: 403 });

    fetchSpy.mockRestore();
  });

  it('handles general HTTP error statuses', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Server Error',
    } as Response);

    const result = await checkAiProviderConnectivity({
      label: 'manager',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiToken: 'token',
    });
    expect(result).toMatchObject({ ok: false, status: 500 });
    fetchSpy.mockRestore();
  });

  it('fails immediately when no base URL is configured', async () => {
    const result = await checkAiProviderConnectivity({
      label: 'manager',
      provider: 'unknown-provider',
      baseUrl: '',
      apiToken: '',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no base URL configured');
  });
});
