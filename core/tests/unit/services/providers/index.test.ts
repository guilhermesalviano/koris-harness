import { describe, it, expect, vi, afterEach } from 'vitest';
import { config } from '../../../../src/config';
import {
  getAIProvider,
  createAIProvider,
  clearProviderCache,
  clearProviderRegistry,
  getSupportedProviders,
  getProviderDefaultBaseUrl,
  getProviderCatalog,
  isOpenAICompatibleProvider,
  resolveProviderBaseUrl,
} from '../../../../src/services/providers';
import { SerialAIProvider } from '../../../../src/services/providers/serial-provider';
import type { ILogger } from '../../../../src/infrastructure/logger';

const logger: ILogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
};

function setParallel(value: boolean): void {
  Object.defineProperty(config.AI, 'PARALLEL', { value, configurable: true, writable: true });
}

describe('getAIProvider', () => {
  afterEach(() => {
    setParallel(true);
    clearProviderCache();
  });

  it('still wraps the provider when ai.parallel is true', () => {
    setParallel(true);
    clearProviderCache();
    const provider = getAIProvider(logger, 'manager');
    expect(provider).toBeInstanceOf(SerialAIProvider);
  });

  it('wraps the provider in a SerialAIProvider when ai.parallel is false', () => {
    setParallel(false);
    clearProviderCache();
    const provider = getAIProvider(logger, 'manager');
    expect(provider).toBeInstanceOf(SerialAIProvider);
  });

  it('caches a single instance per role for a given mode', () => {
    setParallel(false);
    clearProviderCache();
    const first = getAIProvider(logger, 'manager');
    const second = getAIProvider(logger, 'manager');
    expect(first).toBe(second);
  });

  it('keeps interactive and background worker instances separate', () => {
    setParallel(false);
    clearProviderCache();
    const interactive = getAIProvider(logger, 'worker');
    const background = getAIProvider(logger, 'worker', { background: true });
    expect(interactive).toBeInstanceOf(SerialAIProvider);
    expect(background).toBeInstanceOf(SerialAIProvider);
    expect(interactive).not.toBe(background);
  });

  it('returns separate tracked instances for each priority in parallel mode', () => {
    setParallel(true);
    clearProviderCache();
    const interactive = getAIProvider(logger, 'worker');
    const background = getAIProvider(logger, 'worker', { background: true });
    expect(interactive).toBeInstanceOf(SerialAIProvider);
    expect(background).toBeInstanceOf(SerialAIProvider);
    expect(interactive).not.toBe(background);
  });
});

describe('provider registry', () => {
  function withManagerProvider(value: string, run: () => void): void {
    const original = Object.getOwnPropertyDescriptor(config.AI.MANAGER, 'PROVIDER');
    Object.defineProperty(config.AI.MANAGER, 'PROVIDER', { value, configurable: true, writable: true });
    try {
      run();
    } finally {
      if (original) Object.defineProperty(config.AI.MANAGER, 'PROVIDER', original);
      clearProviderCache();
      clearProviderRegistry();
    }
  }

  afterEach(() => {
    clearProviderCache();
    clearProviderRegistry();
  });

  it('discovers ollama, mock and every openai-compatible preset', () => {
    const supported = getSupportedProviders();
    for (const name of [
      'ollama', 'mock', 'openai', 'deepseek', 'groq', 'openrouter',
      'xai', 'mistral', 'together', 'gemini', 'nvidia',
    ]) {
      expect(supported).toContain(name);
    }
  });

  it('exposes shipped default base URLs and openai-compatibility', () => {
    expect(getProviderDefaultBaseUrl('ollama')).toBe('http://localhost:11434');
    expect(getProviderDefaultBaseUrl('deepseek')).toBe('https://api.deepseek.com/v1');
    expect(getProviderDefaultBaseUrl('unknown-provider')).toBeUndefined();
    expect(isOpenAICompatibleProvider('deepseek')).toBe(true);
    expect(isOpenAICompatibleProvider('ollama')).toBe(false);
  });

  it('resolves a configured base URL over the shipped default', () => {
    expect(resolveProviderBaseUrl('deepseek', ' https://proxy.local/v1 ')).toBe('https://proxy.local/v1');
    expect(resolveProviderBaseUrl('deepseek', '')).toBe('https://api.deepseek.com/v1');
    expect(resolveProviderBaseUrl('deepseek', undefined)).toBe('https://api.deepseek.com/v1');
  });

  it('builds the selected preset provider with its base URL', () => {
    withManagerProvider('deepseek', () => {
      const provider = createAIProvider(logger, 'manager');
      expect(provider.name).toBe('deepseek');
    });
  });

  it('falls back to mock for an unknown provider', () => {
    withManagerProvider('does-not-exist', () => {
      const provider = createAIProvider(logger, 'manager');
      expect(provider.name).toBe('mock');
    });
  });

  it('passes each role its own NUM_CTX to the provider (surfaced as max_tokens)', async () => {
    const okResponse = () =>
      new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const fetchMock = vi.fn().mockImplementation(async () => okResponse());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const managerProvider = Object.getOwnPropertyDescriptor(config.AI.MANAGER, 'PROVIDER');
    const managerNumCtx = Object.getOwnPropertyDescriptor(config.AI.MANAGER, 'NUM_CTX');
    const workerProvider = Object.getOwnPropertyDescriptor(config.AI.WORKERS, 'PROVIDER');
    const workerNumCtx = Object.getOwnPropertyDescriptor(config.AI.WORKERS, 'NUM_CTX');
    Object.defineProperty(config.AI.MANAGER, 'PROVIDER', { value: 'deepseek', configurable: true, writable: true });
    Object.defineProperty(config.AI.MANAGER, 'NUM_CTX', { value: 40000, configurable: true, writable: true });
    Object.defineProperty(config.AI.WORKERS, 'PROVIDER', { value: 'deepseek', configurable: true, writable: true });
    Object.defineProperty(config.AI.WORKERS, 'NUM_CTX', { value: 4096, configurable: true, writable: true });

    try {
      await createAIProvider(logger, 'manager').chat({ messages: [{ role: 'user', content: 'hi' }] });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(40000);

      fetchMock.mockClear();
      await createAIProvider(logger, 'worker').chat({ messages: [{ role: 'user', content: 'hi' }] });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(4096);
    } finally {
      globalThis.fetch = originalFetch;
      if (managerProvider) Object.defineProperty(config.AI.MANAGER, 'PROVIDER', managerProvider);
      if (managerNumCtx) Object.defineProperty(config.AI.MANAGER, 'NUM_CTX', managerNumCtx);
      if (workerProvider) Object.defineProperty(config.AI.WORKERS, 'PROVIDER', workerProvider);
      if (workerNumCtx) Object.defineProperty(config.AI.WORKERS, 'NUM_CTX', workerNumCtx);
      clearProviderCache();
      clearProviderRegistry();
    }
  });

  it('builds the embed-role provider from config.AI.EMBED', () => {
    const original = Object.getOwnPropertyDescriptor(config.AI.EMBED, 'PROVIDER');
    Object.defineProperty(config.AI.EMBED, 'PROVIDER', { value: 'deepseek', configurable: true, writable: true });
    try {
      const provider = createAIProvider(logger, 'embed');
      expect(provider.name).toBe('deepseek');
    } finally {
      if (original) Object.defineProperty(config.AI.EMBED, 'PROVIDER', original);
      clearProviderCache();
      clearProviderRegistry();
    }
  });

  it('exposes a provider catalogue with presentational metadata, excluding mock', () => {
    const catalog = getProviderCatalog();
    expect(catalog.map((c) => c.name)).not.toContain('mock');

    const openrouter = catalog.find((c) => c.name === 'openrouter');
    expect(openrouter).toMatchObject({
      label: 'OpenRouter',
      defaultBaseUrl: 'https://openrouter.ai/api/v1',
      apiKeyUrl: 'https://openrouter.ai/keys',
      isOpenAICompatible: true,
      embeddings: false,
    });

    const ollama = catalog.find((c) => c.name === 'ollama');
    expect(ollama).toMatchObject({ label: 'Ollama (local)', embeddings: true });
    expect(ollama?.apiKeyUrl).toBeUndefined();
  });
});
