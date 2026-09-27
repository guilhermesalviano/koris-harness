import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaAIProvider, OllamaAIProviderFactory, providerManifest } from '../../../../../src/services/providers/ollama';
import { config } from '../../../../../src/config';
import { LoggerFactory } from '../../../../../src/infrastructure/logger';
import { THINK_START, THINK_END } from '../../../../../src/constants/thinking';

describe('OllamaAIProvider', () => {
  const originalFetch = globalThis.fetch;
  const logger = LoggerFactory.create();

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('accumulates streamed NDJSON message.content chunks from /api/chat via chatStream', async () => {
    const encoder = new TextEncoder();

    const ndjson =
      JSON.stringify({ message: { role: 'assistant', content: 'Hel' }, done: false }) + '\n' +
      JSON.stringify({ message: { role: 'assistant', content: 'lo' }, done: true }) + '\n';

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(ndjson.slice(0, 20)));
        controller.enqueue(encoder.encode(ndjson.slice(20)));
        controller.close();
      },
    });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson' },
        })
      ) as unknown as typeof fetch;

    const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });

    let out = '';
    for await (const chunk of provider.chatStream({
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      out += chunk;
    }

    expect(out).toBe('Hello');
  });

  it('returns full response from chat() using non-streaming fallback', async () => {
    const responseBody = JSON.stringify({
      message: { role: 'assistant', content: 'Hello' },
      done: true,
    });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(responseBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      ) as unknown as typeof fetch;

    const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });

    const out = await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(out).toBe('Hello');
  });

  it('forwards tools to Ollama chat payload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: 'ok' },
            done: true,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      ) as unknown as typeof fetch;

    globalThis.fetch = fetchMock;
    const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });

    await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'Search files',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    });

    const fetchArgs = (fetchMock as any).mock.calls[0]?.[1];
    const body = typeof fetchArgs?.body === 'string' ? JSON.parse(fetchArgs.body) : undefined;
    const headers = new Headers(fetchArgs?.headers);
    expect(body?.tools).toBeDefined();
    expect(body?.tools[0]?.function?.name).toBe('search');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('maps message images to base64 strings in the Ollama chat payload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: 'I see it' },
            done: true,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      ) as unknown as typeof fetch;

    globalThis.fetch = fetchMock;
    const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });

    await provider.chat({
      messages: [
        {
          role: 'user',
          content: 'describe this',
          images: [
            { data: 'aGVsbG8=', mimeType: 'image/png' },
            { data: 'd29ybGQ=', mimeType: 'image/jpeg' },
          ],
        },
      ],
    });

    const fetchArgs = (fetchMock as any).mock.calls[0]?.[1];
    const body = typeof fetchArgs?.body === 'string' ? JSON.parse(fetchArgs.body) : undefined;
    expect(body?.messages[0]?.images).toEqual(['aGVsbG8=', 'd29ybGQ=']);
  });

  it('leaves messages without images untouched in the Ollama chat payload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: 'ok' },
            done: true,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      ) as unknown as typeof fetch;

    globalThis.fetch = fetchMock;
    const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });

    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });

    const fetchArgs = (fetchMock as any).mock.calls[0]?.[1];
    const body = typeof fetchArgs?.body === 'string' ? JSON.parse(fetchArgs.body) : undefined;
    expect(body?.messages[0]).toEqual({ role: 'user', content: 'hi' });
  });

  it('arms idle timeout before the first stream chunk arrives', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener(
              'abort',
              () => controller.error(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson' },
        });
      }) as unknown as typeof fetch;

    const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
    const outer = new AbortController();
    const iterator = provider.chatStream(
      { messages: [{ role: 'user', content: 'hi' }] },
      { signal: outer.signal },
    );

    const nextChunk = iterator.next();
    await Promise.resolve();
    await Promise.resolve();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), config.AI.TIMEOUTS.HARD_MS);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), config.AI.TIMEOUTS.IDLE_MS);

    outer.abort();
    await expect(nextChunk).rejects.toThrow('Ollama request aborted');
  });

  describe('complete()', () => {
    it('returns message response when no tool calls are in response text', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ message: { role: 'assistant', content: 'Hello there!' } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const res = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(res).toEqual({
        kind: 'message',
        text: 'Hello there!',
        finishReason: 'stop',
      });
    });

    it('returns tool_calls response when response text contains valid tool calls', async () => {
      const toolCallJson = JSON.stringify({
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'calculator',
              arguments: JSON.stringify({ expr: '2+2' }),
            },
          },
        ],
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ message: { role: 'assistant', content: toolCallJson } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const res = await provider.complete({ messages: [{ role: 'user', content: 'calc' }] });
      expect(res.kind).toBe('tool_calls');
      if (res.kind === 'tool_calls') {
        expect(res.calls[0].name).toBe('calculator');
        expect(res.finishReason).toBe('tool_calls');
      }
    });
  });

  describe('chat() error and usage handling', () => {
    it('fires onUsage callback with promptEvalCount and evalCount', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: 'Hi' },
            prompt_eval_count: 12,
            eval_count: 5,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      ) as unknown as typeof fetch;

      const onUsage = vi.fn();
      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const out = await provider.chat(
        { messages: [{ role: 'user', content: 'hi' }] },
        { onUsage }
      );

      expect(out).toBe('Hi');
      expect(onUsage).toHaveBeenCalledWith({ inputTokens: 12, outputTokens: 5 });
    });

    it('handles non-stream timeout error when abort signal was internal', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow('Ollama request timed out during non-stream /api/chat request');
    });

    it('handles non-stream abort error when caller signal aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'hi' }] }, { signal: controller.signal })
      ).rejects.toThrow('Ollama request aborted');
    });

    it('rethrows generic non-abort errors in chat()', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow('Network offline');
    });

    it('returns empty string when Ollama response content was empty', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: '' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const out = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
      expect(out).toBe('');
    });

    it('formats tool_calls from message.tool_calls when content is empty', async () => {
      const toolCalls = [{ function: { name: 'test_tool', arguments: '{"a":1}' } }];
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: '', tool_calls: toolCalls },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const out = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
      expect(out).toBe(JSON.stringify({ tool_calls: toolCalls }));
    });

    it('throws error when post returns non-ok HTTP status', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Model not found', { status: 404, statusText: 'Not Found' })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow('Ollama /api/chat failed (404): Model not found');
    });
  });

  describe('chatStream() edge cases', () => {
    it('falls back to non-stream when response body is null', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              message: { role: 'assistant', content: 'Fallback response' },
              prompt_eval_count: 10,
              eval_count: 4,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        ) as unknown as typeof fetch;

      const onUsage = vi.fn();
      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });

      let result = '';
      for await (const chunk of provider.chatStream(
        { messages: [{ role: 'user', content: 'hi' }] },
        { onUsage }
      )) {
        result += chunk;
      }

      expect(result).toBe('Fallback response');
      expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 4 });
    });

    it('throws error when a stream chunk has an error field', async () => {
      const encoder = new TextEncoder();
      const ndjson = JSON.stringify({ error: 'CUDA out of memory' }) + '\n';
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(ndjson));
          controller.close();
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });

      await expect(async () => {
        for await (const _ of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
          // iterate
        }
      }).rejects.toThrow('CUDA out of memory');
    });

    it('handles thinking chunks and emits THINK_START / THINK_END markers', async () => {
      const encoder = new TextEncoder();
      const lines = [
        JSON.stringify({ message: { role: 'assistant', thinking: 'Hmm, let me think.' }, done: false }),
        JSON.stringify({ message: { role: 'assistant', content: 'Here is the answer.' }, done: false }),
        JSON.stringify({ done: true, prompt_eval_count: 20, eval_count: 10 }),
      ].join('\n') + '\n';

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(lines));
          controller.close();
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
      ) as unknown as typeof fetch;

      const onUsage = vi.fn();
      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });

      const chunks: string[] = [];
      for await (const chunk of provider.chatStream(
        { messages: [{ role: 'user', content: 'hi' }] },
        { onUsage }
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        THINK_START,
        'Hmm, let me think.',
        THINK_END,
        'Here is the answer.',
      ]);
      expect(onUsage).toHaveBeenCalledWith({ inputTokens: 20, outputTokens: 10 });
    });

    it('emits THINK_END when stream is done while still in thinking', async () => {
      const encoder = new TextEncoder();
      const lines = [
        JSON.stringify({ message: { role: 'assistant', thinking: 'Still thinking...' }, done: false }),
        JSON.stringify({ message: { role: 'assistant', content: 'Finished!' }, done: true }),
      ].join('\n') + '\n';

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(lines));
          controller.close();
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const chunks: string[] = [];
      for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([THINK_START, 'Still thinking...', THINK_END, 'Finished!']);
    });

    it('yields tool calls if returned on done chunk', async () => {
      const encoder = new TextEncoder();
      const toolCalls = [{ function: { name: 'my_tool', arguments: '{"x": 1}' } }];
      const lines = [
        JSON.stringify({ message: { role: 'assistant', tool_calls: toolCalls }, done: true }),
      ].join('\n') + '\n';

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(lines));
          controller.close();
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const chunks: string[] = [];
      for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([JSON.stringify({ tool_calls: toolCalls })]);
    });

    it('buffers JSON tokens starting with { until done', async () => {
      const encoder = new TextEncoder();
      const lines = [
        JSON.stringify({ message: { role: 'assistant', content: '{"status":' }, done: false }),
        JSON.stringify({ message: { role: 'assistant', content: '"success"}' }, done: true }),
      ].join('\n') + '\n';

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(lines));
          controller.close();
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const chunks: string[] = [];
      for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['{"status":"success"}']);
    });

    it('falls back to non-stream retry if stream produces no answer', async () => {
      const encoder = new TextEncoder();
      const lines = [
        JSON.stringify({ done: false }),
        JSON.stringify({ done: true }),
      ].join('\n') + '\n';

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(lines));
          controller.close();
        },
      });

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ message: { role: 'assistant', content: 'Retried answer' } }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const chunks: string[] = [];
      for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Retried answer']);
    });

    it('parses SSE data: lines, ignores [DONE], empty lines, and malformed json', async () => {
      const encoder = new TextEncoder();
      const text = [
        'data: ' + JSON.stringify({ response: 'First ' }),
        '',
        'data: [DONE]',
        'not valid json',
        'data: ' + JSON.stringify({ response: 'Second' }),
        JSON.stringify({ done: true }),
      ].join('\n') + '\n';

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(text));
          controller.close();
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      let result = '';
      for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        result += chunk;
      }

      expect(result).toBe('First Second');
    });

    it('reports stream timeout error when abort signal was internal', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new DOMException('The operation was aborted', 'AbortError'));
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      await expect(async () => {
        for await (const _ of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
          // iterate
        }
      }).rejects.toThrow('Ollama request timed out while streaming');
    });

    it('rethrows non-abort errors from stream', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('Connection reset by peer'));
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      await expect(async () => {
        for await (const _ of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
          // iterate
        }
      }).rejects.toThrow('Connection reset by peer');
    });
  });

  describe('healthCheck()', () => {
    it('returns ok: true with version when /api/version succeeds', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ version: '0.1.32' }), { status: 200 })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const health = await provider.healthCheck();
      expect(health).toEqual({ ok: true, detail: 'v0.1.32' });
    });

    it('returns ok: true with default "ok" when version is missing', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const health = await provider.healthCheck();
      expect(health).toEqual({ ok: true, detail: 'ok' });
    });

    it('returns ok: false when response is not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Service Unavailable', { status: 503 })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const health = await provider.healthCheck();
      expect(health).toEqual({ ok: false, detail: 'HTTP 503' });
    });

    it('returns ok: false when fetch rejects', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      const health = await provider.healthCheck();
      expect(health).toEqual({ ok: false, detail: 'Connection refused' });
    });
  });

  describe('embed()', () => {
    it('throws if embeddings are disabled in options', async () => {
      const provider = new OllamaAIProvider(logger, {
        baseUrl: 'http://localhost:11434',
        model: 'test',
        embeddingEnabled: false,
      });

      await expect(provider.embed('hello')).rejects.toThrow('Embeddings are disabled in configuration');
    });

    it('returns embedding array on success', async () => {
      const embedding = [0.1, 0.2, 0.3];
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ embedding }), { status: 200 })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, {
        baseUrl: 'http://localhost:11434',
        model: 'test',
        embeddingEnabled: true,
        embeddingModel: 'nomic-embed-text',
      });

      const result = await provider.embed('hello world');
      expect(result).toEqual(embedding);
    });

    it('throws error when embeddings endpoint fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Embed error', { status: 500 })
      ) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, {
        baseUrl: 'http://localhost:11434',
        model: 'test',
        embeddingEnabled: true,
      });

      await expect(provider.embed('hello')).rejects.toThrow('Ollama /api/embeddings failed (500)');
    });
  });

  describe('makeController()', () => {
    it('immediately aborts controller if outerSignal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort(new Error('Already cancelled'));

      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        expect(init.signal.aborted).toBe(true);
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }) as unknown as typeof fetch;

      const provider = new OllamaAIProvider(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'hi' }] }, { signal: controller.signal })
      ).rejects.toThrow('Ollama request aborted');
    });
  });

  describe('OllamaAIProviderFactory and providerManifest', () => {
    it('manifest provides correct registration and factory creates instance', () => {
      const manifests = providerManifest();
      expect(manifests).toHaveLength(1);
      const manifest = manifests[0];
      expect(manifest.name).toBe('ollama');
      expect(manifest.embeddings).toBe(true);

      const created = manifest.create(logger, { baseUrl: 'http://localhost:11434', model: 'test' });
      expect(created).toBeInstanceOf(OllamaAIProvider);
      expect(created.name).toBe('ollama');

      const factoryInstance = OllamaAIProviderFactory.create(logger);
      expect(factoryInstance).toBeInstanceOf(OllamaAIProvider);
    });
  });
});

