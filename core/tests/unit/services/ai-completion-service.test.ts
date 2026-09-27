import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AICompletionService, AIServiceError } from '../../../src/services/ai-completion-service';
import type { AIProvider, AIResponse } from '../../../src/types/chat';
import type { ILogger } from '../../../src/infrastructure/logger';

const logger: ILogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
};

function providerWith(complete: AIProvider['complete']): AIProvider {
  return {
    name: 'test',
    complete,
    chat: vi.fn(),
    chatStream: vi.fn(),
    healthCheck: vi.fn(),
  } as AIProvider;
}

function makeService(complete: AIProvider['complete'], options?: { role?: 'manager' | 'worker'; agentName?: string; retryAttempts?: number; retryBackoffMs?: number }) {
  const auditService = { record: vi.fn() };
  const service = new AICompletionService(() => providerWith(complete), logger, {
    role: options?.role,
    agentName: options?.agentName,
    auditService,
    retry: {
      attempts: options?.retryAttempts ?? 0,
      backoffMs: options?.retryBackoffMs ?? 1,
    },
  });
  return { service, auditService };
}

describe('AICompletionService', () => {
  const request = { messages: [{ role: 'user' as const, content: 'hello' }] };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the typed provider response unchanged', async () => {
    const expected: AIResponse = { kind: 'message', text: 'world', finishReason: 'stop' };
    const complete = vi.fn().mockResolvedValue(expected);
    const { service } = makeService(complete);

    await expect(service.complete(request)).resolves.toBe(expected);
    expect(complete).toHaveBeenCalledWith(request, expect.objectContaining({ onUsage: expect.any(Function) }));
  });

  it('preserves typed tool calls', async () => {
    const expected: AIResponse = {
      kind: 'tool_calls',
      calls: [{ name: 'weather', arguments: { city: 'Recife' } }],
      finishReason: 'tool_calls',
    };
    const { service } = makeService(vi.fn().mockResolvedValue(expected));

    await expect(service.complete(request)).resolves.toEqual(expected);
  });

  it('records a successful LLM audit entry', async () => {
    const expected: AIResponse = { kind: 'message', text: 'world', finishReason: 'stop' };
    const { service, auditService } = makeService(vi.fn().mockResolvedValue(expected));

    await service.complete(request, { audit: { runId: 'r1', sessionId: 's1', channel: 'web' } });

    expect(auditService.record).toHaveBeenCalledTimes(1);
    const entry = auditService.record.mock.calls[0][0];
    expect(entry).toMatchObject({
      type: 'llm',
      role: 'manager',
      provider: 'test',
      runId: 'r1',
      sessionId: 's1',
      channel: 'web',
      prompt: JSON.stringify(request.messages),
      promptLength: JSON.stringify(request.messages).length,
      response: 'world',
      responseLength: 5,
      finishReason: 'stop',
      toolCalls: 0,
      toolsEnabled: false,
      status: 'success',
    });
    expect(typeof entry.id).toBe('string');
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records provider usage tokens into the audit entry', async () => {
    const complete = vi.fn().mockImplementation((_request: unknown, options?: { onUsage?: (u: { inputTokens?: number; outputTokens?: number }) => void }) => {
      options?.onUsage?.({ inputTokens: 300, outputTokens: 120 });
      return Promise.resolve({ kind: 'message', text: 'world', finishReason: 'stop' });
    });
    const { service, auditService } = makeService(complete);

    await service.complete(request);

    const entry = auditService.record.mock.calls[0][0];
    expect(entry.inputTokens).toBe(300);
    expect(entry.outputTokens).toBe(120);
  });

  it('masks base64 image data in the audited prompt', async () => {
    const expected: AIResponse = { kind: 'message', text: 'ok', finishReason: 'stop' };
    const { service, auditService } = makeService(vi.fn().mockResolvedValue(expected));
    const imageRequest = {
      ...request,
      messages: [
        { role: 'user', content: 'describe this', images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }] },
      ],
    };

    await service.complete(imageRequest);

    const entry = auditService.record.mock.calls[0][0];
    expect(entry.prompt).toContain('[image:8 bytes]');
    expect(entry.prompt).not.toContain('aGVsbG8=');
  });

  it('records tool-call counts in the audit entry', async () => {
    const expected: AIResponse = {
      kind: 'tool_calls',
      calls: [{ name: 'weather', arguments: { city: 'Recife' } }, { name: 'search', arguments: { q: 'x' } }],
      finishReason: 'tool_calls',
    };
    const { service, auditService } = makeService(vi.fn().mockResolvedValue(expected));
    const toolRequest = {
      ...request,
      tools: [
        {
          type: 'function' as const,
          function: { name: 'weather', description: 'weather', parameters: {} },
        },
      ],
    };

    await service.complete(toolRequest);

    const entry = auditService.record.mock.calls[0][0];
    expect(entry.toolCalls).toBe(2);
    expect(entry.toolsEnabled).toBe(true);
    expect(entry.response).toBe(JSON.stringify(expected.calls));
  });

  it('records toolsEnabled false when no tools are provided in the request', async () => {
    const expected: AIResponse = { kind: 'message', text: 'ok', finishReason: 'stop' };
    const { service, auditService } = makeService(vi.fn().mockResolvedValue(expected));

    await service.complete(request);

    const entry = auditService.record.mock.calls[0][0];
    expect(entry.toolsEnabled).toBe(false);
  });

  it('records an error audit entry with the mapped error code', async () => {
    const { service, auditService } = makeService(vi.fn().mockRejectedValue(new Error('HTTP 429 rate limit')));

    await expect(service.complete(request)).rejects.toMatchObject({ code: 'rate_limited' });

    const entry = auditService.record.mock.calls[0][0];
    expect(entry).toMatchObject({
      type: 'llm',
      status: 'error',
      errorCode: 'rate_limited',
      errorMessage: expect.stringContaining('so many requests'),
    });
  });

  it.each([
    ['request timed out', 'timeout'],
    ['HTTP 401 authentication failed', 'authentication'],
    ['HTTP 429 rate limit', 'rate_limited'],
    ['response missing content', 'malformed_response'],
    ['fetch failed', 'unavailable'],
    ["OpenRouter /chat/completions failed (400): this model's maximum context length is 128000 tokens", 'context_length'],
    ['Please reduce the length of the messages', 'context_length'],
    ['NVIDIA /chat/completions failed (413): payload too large', 'context_length'],
  ] as const)('maps %s to %s', async (message, code) => {
    const { service } = makeService(vi.fn().mockRejectedValue(new Error(message)));

    await expect(service.complete(request)).rejects.toMatchObject({ code });
  });

  it('maps a provider HTTP status to its friendly message', async () => {
    const { service } = makeService(vi.fn().mockRejectedValue(new Error('NVIDIA /chat/completions failed (429): {"error":"rate limit"}')));

    await expect(service.complete(request)).rejects.toMatchObject({
      code: 'rate_limited',
      statusCode: 429,
    });
    await expect(service.complete(request)).rejects.toThrow(/so many requests/i);
  });

  it.each([
    [401, 'authentication', /API key/i],
    [403, 'authentication', /permission/i],
    [408, 'timeout', /bit too long/i],
    [500, 'unavailable', /went wrong on the server/i],
    [503, 'unavailable', /quick nap/i],
    [504, 'timeout', /too long to reply/i],
  ] as const)('maps status %s to %s with a friendly message', async (status, code, messagePattern) => {
    const { service } = makeService(vi.fn().mockRejectedValue(new Error(`Ollama /api/chat failed (${status}): raw body`)));

    const err = await service.complete(request).catch((e: unknown) => e);
    expect(err).toMatchObject({ code, statusCode: status });
    expect((err as Error).message).toMatch(messagePattern);
  });

  it('keeps the raw provider message and status when the status has no mapping', async () => {
    const { service } = makeService(vi.fn().mockRejectedValue(new Error('Ollama /api/chat failed (418): I am a teapot')));

    const err = await service.complete(request).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'unknown', statusCode: 418 });
    expect((err as Error).message).toBe('Ollama /api/chat failed (418): I am a teapot');
  });

  it('serializes an AIServiceError into a structured JSON payload', async () => {
    const { service } = makeService(vi.fn().mockRejectedValue(new Error('Ollama /api/chat failed (429): nope')));

    const err = await service.complete(request).catch((e: unknown) => e);
    expect(JSON.parse(JSON.stringify(err))).toEqual({
      code: 'rate_limited',
      statusCode: 429,
      message: expect.stringMatching(/so many requests/i),
    });
  });

  it('maps an aborted signal to an aborted error', async () => {
    const controller = new AbortController();
    controller.abort();
    const { service } = makeService(vi.fn().mockRejectedValue(new Error('cancelled')));

    await expect(service.complete(request, { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'aborted' });
  });

  it('does not wrap an existing AIServiceError', async () => {
    const original = new AIServiceError('unavailable', 'offline');
    const { service } = makeService(vi.fn().mockRejectedValue(original));

    await expect(service.complete(request)).rejects.toBe(original);
  });

  it('retries a transient unavailable error and succeeds', async () => {
    const expected: AIResponse = { kind: 'message', text: 'world', finishReason: 'stop' };
    const complete = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(expected);
    const { service, auditService } = makeService(complete, { retryAttempts: 2, retryBackoffMs: 1 });

    await expect(service.complete(request)).resolves.toBe(expected);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith('AI provider transient error, retrying', expect.objectContaining({ attempt: 1 }));
    expect(auditService.record).toHaveBeenCalledTimes(1);
    expect(auditService.record.mock.calls[0][0]).toMatchObject({ status: 'success' });
  });

  it('exhausts retries before throwing the mapped error', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const { service, auditService } = makeService(complete, { retryAttempts: 2, retryBackoffMs: 1 });

    await expect(service.complete(request)).rejects.toMatchObject({ code: 'unavailable' });

    expect(complete).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(auditService.record).toHaveBeenCalledTimes(1);
    expect(auditService.record.mock.calls[0][0]).toMatchObject({ status: 'error', errorCode: 'unavailable' });
  });

  it('retries a transient 429 (rate_limited) error and succeeds', async () => {
    const expected: AIResponse = { kind: 'message', text: 'world', finishReason: 'stop' };
    const complete = vi.fn()
      .mockRejectedValueOnce(new Error('NVIDIA /chat/completions failed (429): rate limit'))
      .mockResolvedValueOnce(expected);
    const { service, auditService } = makeService(complete, { retryAttempts: 2, retryBackoffMs: 1 });

    await expect(service.complete(request)).resolves.toBe(expected);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith('AI provider transient error, retrying', expect.objectContaining({ attempt: 1 }));
    expect(auditService.record).toHaveBeenCalledTimes(1);
    expect(auditService.record.mock.calls[0][0]).toMatchObject({ status: 'success' });
  });

  it('exhausts retries on a persistent 429 before throwing rate_limited', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('NVIDIA /chat/completions failed (429): rate limit'));
    const { service, auditService } = makeService(complete, { retryAttempts: 2, retryBackoffMs: 1 });

    await expect(service.complete(request)).rejects.toMatchObject({ code: 'rate_limited' });

    expect(complete).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(auditService.record).toHaveBeenCalledTimes(1);
    expect(auditService.record.mock.calls[0][0]).toMatchObject({ status: 'error', errorCode: 'rate_limited' });
  });

  it('does not retry non-transient errors', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('response missing content'));
    const { service } = makeService(complete, { retryAttempts: 2, retryBackoffMs: 1 });

    await expect(service.complete(request)).rejects.toMatchObject({ code: 'malformed_response' });

    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the request was aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const complete = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const { service } = makeService(complete, { retryAttempts: 2, retryBackoffMs: 1 });

    await expect(service.complete(request, { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'aborted' });

    expect(complete).toHaveBeenCalledTimes(1);
  });
});
