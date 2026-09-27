import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockAIProvider, MockAIProviderFactory } from '../../../../../src/services/providers/mock';
import type { ILogger } from '../../../../../src/infrastructure/logger';

describe('MockAIProvider', () => {
  const logger: ILogger = {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with name', () => {
    const provider = new MockAIProvider(logger, 'test-mock');
    expect(provider.name).toBe('test-mock');
  });

  it('uses default name when not provided', () => {
    const provider = new MockAIProvider(logger);
    expect(provider.name).toBe('mock');
  });

  it('responds to chat requests', async () => {
    const provider = new MockAIProvider(logger);
    const response = await provider.chat({
      model: 'mock',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(response).toBeDefined();
    expect(response).toContain('Hello');
    expect(response).toContain('mock AI provider');
    expect(logger.debug).toHaveBeenCalledWith('Mock provider chat request', {
      messagesCount: 1,
      hasTools: false,
    });
    expect(logger.info).toHaveBeenCalledWith('Mock provider chat response', {
      responseLength: response.length,
    });
  });

  it('returns a typed completion response', async () => {
    const provider = new MockAIProvider(logger);
    const response = await provider.complete({
      messages: [{ role: 'user', content: 'typed' }],
    });

    expect(response).toEqual({
      kind: 'message',
      text: expect.stringContaining('typed'),
      finishReason: 'stop',
    });
  });

  it('uses latest user message when there are multiple roles', async () => {
    const provider = new MockAIProvider(logger);
    const response = await provider.chat({
      model: 'mock',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'last-user' },
      ],
    });

    expect(response).toContain('last-user');
  });

  it('handles chat request with no user message', async () => {
    const provider = new MockAIProvider(logger);
    const response = await provider.chat({
      model: 'mock',
      messages: [{ role: 'assistant', content: 'only-assistant' }],
    });

    expect(response).toContain('I received your message: ""');
  });

  it('tracks hasTools=true in logs when tools are provided', async () => {
    const provider = new MockAIProvider(logger);
    await provider.chat({
      model: 'mock',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [{ type: 'function', function: { name: 'x', description: 'd', parameters: {} } }],
    });

    expect(logger.debug).toHaveBeenCalledWith('Mock provider chat request', {
      messagesCount: 1,
      hasTools: true,
    });
  });

  it('streams response character by character', async () => {
    const provider = new MockAIProvider(logger);
    const chunks: string[] = [];

    for await (const ch of provider.chatStream({
      model: 'mock',
      messages: [{ role: 'user', content: 'stream-test' }],
    })) {
      chunks.push(ch);
    }

    const joined = chunks.join('');
    expect(joined).toContain('stream-test');
    expect(logger.debug).toHaveBeenCalledWith('Mock provider chatStream started', {
      messagesCount: 1,
      hasTools: false,
    });
    expect(logger.info).toHaveBeenCalledWith('Mock provider chatStream complete', {
      responseLength: joined.length,
    });
  });

  it('stops streaming early when abort signal is set', async () => {
    const provider = new MockAIProvider(logger);
    const controller = new AbortController();
    const chunks: string[] = [];

    for await (const ch of provider.chatStream({
      model: 'mock',
      messages: [{ role: 'user', content: 'stop-me' }],
    }, { signal: controller.signal })) {
      chunks.push(ch);
      controller.abort();
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan('I received your message: "stop-me"\n\n(Using mock AI provider — set AI_PROVIDER=ollama to enable Ollama.)'.length);
    expect(logger.info).not.toHaveBeenCalledWith('Mock provider chatStream complete', expect.anything());
  });

  it('reports healthy status', async () => {
    const provider = new MockAIProvider(logger);
    const health = await provider.healthCheck();

    expect(health).toEqual({ ok: true, detail: 'mock provider' });
    expect(logger.debug).toHaveBeenCalledWith('Mock provider health check');
  });

  it('factory creates MockAIProvider with custom name', () => {
    const provider = MockAIProviderFactory.create(logger, 'factory-name');
    expect(provider.name).toBe('factory-name');
  });
});
