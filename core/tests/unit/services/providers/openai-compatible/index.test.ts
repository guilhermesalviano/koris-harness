import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  OpenAICompatibleAIProvider,
} from '../../../../../src/services/providers/openai-compatible';
import { findOpenAICompatiblePreset } from '../../../../../src/services/providers/openai-compatible/presets';
import { config } from '../../../../../src/config';
import { LoggerFactory } from '../../../../../src/infrastructure/logger';

const logger = LoggerFactory.create();
const nvidiaPreset = findOpenAICompatiblePreset('nvidia')!;
const deepseekPreset = findOpenAICompatiblePreset('deepseek')!;

function makeSSE(chunks: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = chunks
    .map((c) => `data: ${JSON.stringify(c)}\n\n`)
    .join('') + 'data: [DONE]\n\n';

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
}

describe('OpenAICompatibleAIProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('accumulates streamed SSE content chunks via chatStream', async () => {
    const stream = makeSSE([
      { choices: [{ delta: { role: 'assistant', content: 'Hel' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });

    let out = '';
    for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
      out += chunk;
    }

    expect(out).toBe('Hello');
  });

  it('returns full response from chat() non-streaming call', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'Hello from the model' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });

    const out = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(out).toBe('Hello from the model');
  });

  it('forwards tools to the chat payload with Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    globalThis.fetch = fetchMock;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, {
      model: 'test-model',
      apiToken: 'nvapi-secret',
    });

    await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: { name: 'search', description: 'Search files', parameters: { type: 'object', properties: {} } },
        },
      ],
    });

    const fetchArgs = (fetchMock as any).mock.calls[0]?.[1];
    const body = JSON.parse(fetchArgs.body);
    const headers = new Headers(fetchArgs.headers);

    expect(body.tools).toBeDefined();
    expect(body.tools[0]?.function?.name).toBe('search');
    expect(headers.get('authorization')).toBe('Bearer nvapi-secret');
  });

  it('sends max_tokens from numCtx and omits it when unset', async () => {
    const okResponse = () =>
      new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const fetchMock = vi.fn().mockImplementation(async () => okResponse()) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model', numCtx: 8192 })
      .chat({ messages: [{ role: 'user', content: 'hi' }] });
    let body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(8192);

    (fetchMock as any).mockClear();
    await new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' })
      .chat({ messages: [{ role: 'user', content: 'hi' }] });
    body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.max_tokens).toBeUndefined();
  });

  it('sends the openrouter attribution headers, other presets do not', async () => {
    const openrouterPreset = findOpenAICompatiblePreset('openrouter')!;
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    await new OpenAICompatibleAIProvider(logger, openrouterPreset, { model: 'openai/gpt-4o-mini' })
      .chat({ messages: [{ role: 'user', content: 'hi' }] });
    let headers = new Headers((fetchMock as any).mock.calls[0][1].headers);
    expect(headers.get('http-referer')).toBe('https://github.com/guilhermesalviano/koris');
    expect(headers.get('x-title')).toBe('koris');

    fetchMock.mockClear();
    await new OpenAICompatibleAIProvider(logger, deepseekPreset, { model: 'deepseek-chat' })
      .chat({ messages: [{ role: 'user', content: 'hi' }] });
    headers = new Headers((fetchMock as any).mock.calls[0][1].headers);
    expect(headers.get('http-referer')).toBeNull();
    expect(headers.get('x-title')).toBeNull();
  });

  it('routes a preset to its own base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    globalThis.fetch = fetchMock;

    const provider = new OpenAICompatibleAIProvider(logger, deepseekPreset, {
      model: 'deepseek-chat',
      apiToken: 'sk-deepseek',
    });
    expect(provider.name).toBe('deepseek');

    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });

    const calledUrl = (fetchMock as any).mock.calls[0]?.[0];
    expect(calledUrl).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('transforms message images into OpenAI content blocks in the payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'I see it' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    globalThis.fetch = fetchMock;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });

    await provider.chat({
      messages: [
        {
          role: 'user',
          content: 'describe this',
          images: [
            { data: 'aGVsbG8=', mimeType: 'image/png' },
            { data: 'd29ybGQ=' },
          ],
        },
      ],
    });

    const fetchArgs = (fetchMock as any).mock.calls[0]?.[1];
    const body = JSON.parse(fetchArgs.body);

    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'describe this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,d29ybGQ=' } },
      ],
    });
  });

  it('leaves messages without images untouched in the payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    globalThis.fetch = fetchMock;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });

    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });

    const fetchArgs = (fetchMock as any).mock.calls[0]?.[1];
    const body = JSON.parse(fetchArgs.body);
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hi' });
  });

  it('serializes assistant tool_call arguments as JSON strings in the payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    globalThis.fetch = fetchMock;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });

    await provider.chat({
      messages: [
        { role: 'user', content: 'create a todo' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', function: { name: 'coredash__create_todo', arguments: { title: 'alimentar os cachorros' } } },
            { id: 'call_2', function: { name: 'coredash__coredash_health', arguments: {} } },
          ],
        },
        { role: 'tool', content: 'Tool: coredash__create_todo, Result: ok', tool_call_id: 'call_1' },
        { role: 'tool', content: 'Tool: coredash__coredash_health, Result: ok', tool_call_id: 'call_2' },
      ],
    });

    const fetchArgs = (fetchMock as any).mock.calls[0]?.[1];
    const body = JSON.parse(fetchArgs.body);

    expect(body.messages[1].tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'coredash__create_todo', arguments: '{"title":"alimentar os cachorros"}' },
      },
      {
        id: 'call_2',
        type: 'function',
        function: { name: 'coredash__coredash_health', arguments: '{}' },
      },
    ]);
    expect(body.messages[2].tool_call_id).toBe('call_1');
    expect(body.messages[3].tool_call_id).toBe('call_2');
  });

  it('echoes a tool call\'s extra_content (Gemini thought_signature) back in the payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
    const extraContent = { google: { thought_signature: 'sig-abc' } };

    await provider.chat({
      messages: [
        { role: 'user', content: 'order lunch' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_1', function: { name: 'start_errand', arguments: { goal: 'lunch' } }, extraContent }],
        },
        { role: 'tool', content: 'Tool: start_errand, Result: ok', tool_call_id: 'call_1' },
      ],
    });

    const body = JSON.parse((fetchMock as any).mock.calls[0]?.[1].body);
    expect(body.messages[1].tool_calls[0]).toEqual({
      id: 'call_1',
      type: 'function',
      function: { name: 'start_errand', arguments: '{"goal":"lunch"}' },
      extra_content: extraContent,
    });
    expect(body.messages[1]).not.toHaveProperty('extraContent');
  });

  it('keeps a streamed tool call\'s extra_content (Gemini thought_signature)', async () => {
    const extraContent = { google: { thought_signature: 'sig-abc' } };
    const stream = makeSSE([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'start_errand', arguments: '{}' }, extra_content: extraContent }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
    let out = '';
    for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'order lunch' }] })) out += chunk;

    expect(JSON.parse(out).tool_calls[0].extra_content).toEqual(extraContent);
  });

  it('returns serialized tool_calls JSON when chat response contains tool calls', async () => {
    const toolCalls = [
      { id: 'call_1', type: 'function', function: { name: 'get_skill', arguments: '{"skill_name":"git"}' } },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls }, finish_reason: 'tool_calls' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });

    const out = await provider.chat({ messages: [{ role: 'user', content: 'use a skill' }] });
    const parsed = JSON.parse(out);
    expect(parsed.tool_calls[0].function.name).toBe('get_skill');
  });

  it('accumulates streamed tool calls across SSE chunks via chatStream', async () => {
    const stream = makeSSE([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_skill', arguments: '' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"skill_name":"git"}' } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });

    let out = '';
    for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'use a skill' }] })) {
      out += chunk;
    }

    const parsed = JSON.parse(out);
    expect(parsed.tool_calls[0].function.name).toBe('get_skill');
    expect(parsed.tool_calls[0].function.arguments).toBe('{"skill_name":"git"}');
  });

  it('wraps reasoning_content in THINK markers during streaming', async () => {
    const { THINK_START, THINK_END } = await import('../../../../../src/constants/thinking');

    const stream = makeSSE([
      { choices: [{ delta: { reasoning_content: 'let me think...' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'Answer' }, finish_reason: 'stop' }] },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });

    const chunks: string[] = [];
    for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toBe(THINK_START);
    expect(chunks[1]).toBe('let me think...');
    expect(chunks[2]).toBe(THINK_END);
    expect(chunks[3]).toBe('Answer');
  });

  it('healthCheck returns ok: true when /models returns 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });

    const result = await provider.healthCheck();
    expect(result.ok).toBe(true);
  });

  it('healthCheck returns ok: false on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });

    const result = await provider.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('HTTP 401');
  });

  it('arms idle timeout before first stream chunk', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    globalThis.fetch = vi.fn().mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });

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
    await expect(nextChunk).rejects.toThrow('nvidia request aborted');
  });

  it('throws a helpful error when an nvidia model is missing its namespace prefix (404 page not found)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('404 page not found', { status: 404 }),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, {
      model: 'gemma-4-31b-it', // missing "google/" prefix
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('namespace prefix');
  });

  it('emits a generic (404) error for a namespaced nvidia model', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('nope', { status: 404 }),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, {
      model: 'google/gemma-4-31b-it',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/nvidia \/chat\/completions failed \(404\)/);
  });

  it('emits a generic (404) error for a non-nvidia preset with no namespace hint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('404 page not found', { status: 404 }),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAIProvider(logger, deepseekPreset, {
      model: 'deepseek-chat',
    });

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/deepseek \/chat\/completions failed \(404\)/);
  });

  it('uses the preset base URL and config model when no opts are given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    globalThis.fetch = fetchMock;

    const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset);
    expect(provider.name).toBe('nvidia');

    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });

    const calledUrl = (fetchMock as any).mock.calls[0]?.[0];
    const fetchArgs = (fetchMock as any).mock.calls[0]?.[1];
    const body = JSON.parse(fetchArgs.body);

    expect(calledUrl).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(body.model).toBe(config.AI.MANAGER.MODEL);
  });

  describe('complete()', () => {
    it('returns message response when no tool calls exist', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'Plain response' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      const res = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(res).toEqual({
        kind: 'message',
        text: 'Plain response',
        finishReason: 'stop',
      });
    });

    it('returns tool_calls response when response contains tool calls', async () => {
      const toolCallJson = JSON.stringify({
        tool_calls: [
          {
            type: 'function',
            function: { name: 'calculator', arguments: '{"expr":"2+2"}' },
          },
        ],
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: toolCallJson }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      const res = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(res.kind).toBe('tool_calls');
      if (res.kind === 'tool_calls') {
        expect(res.calls[0].name).toBe('calculator');
        expect(res.finishReason).toBe('tool_calls');
      }
    });
  });

  describe('embed()', () => {
    it('throws if embeddings are disabled in options', async () => {
      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, {
        model: 'test-model',
        embeddingEnabled: false,
      });

      await expect(provider.embed('test')).rejects.toThrow('Embeddings are disabled in configuration');
    });

    it('returns embedding array on success', async () => {
      const embedding = [0.1, 0.2, 0.3];
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ embedding }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, {
        model: 'test-model',
        embeddingEnabled: true,
        embeddingModel: 'text-embedding-3',
      });

      const result = await provider.embed('hello');
      expect(result).toEqual(embedding);
    });

    it('throws when /embeddings returns non-ok status', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('Failed', { status: 500 }),
      ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, {
        model: 'test-model',
        embeddingEnabled: true,
      });

      await expect(provider.embed('hello')).rejects.toThrow('nvidia /embeddings failed (500)');
    });
  });

  describe('chat() additional error cases', () => {
    it('throws API error when response contains error property', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'Invalid API key' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow('nvidia API error: Invalid API key');
    });

    it('throws when response is missing choices', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow('nvidia response missing choices');
    });

    it('returns tool_calls when choice finish_reason is tool_calls', async () => {
      const toolCalls = [{ id: 'call_1', type: 'function', function: { name: 'calc', arguments: '{}' } }];
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{
              message: { role: 'assistant', content: null, tool_calls: toolCalls },
              finish_reason: 'tool_calls',
            }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      const out = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
      expect(out).toBe(JSON.stringify({ tool_calls: toolCalls }));
    });

    it('throws when response message is missing content', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow('nvidia response missing content');
    });

    it('reports request timed out when internal abort happens', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow('nvidia request timed out');
    });
  });

  describe('chatStream() edge cases', () => {
    it('accumulates and yields streamed tool calls', async () => {
      const stream = makeSSE([
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_1',
                function: { name: 'get_', arguments: '{"q":' },
              }],
            },
            finish_reason: null,
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { name: 'weather', arguments: '"Paris"}' },
              }],
            },
            finish_reason: null,
          }],
        },
        {
          choices: [{
            delta: {},
            finish_reason: 'tool_calls',
          }],
        },
      ]);

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      const chunks: string[] = [];
      for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      const parsed = JSON.parse(chunks[0]);
      expect(parsed.tool_calls[0].function.name).toBe('get_weather');
      expect(parsed.tool_calls[0].function.arguments).toBe('{"q":"Paris"}');
    });

    it('flushes text on length and content_filter finish reasons', async () => {
      const stream = makeSSE([
        { choices: [{ delta: { content: 'Truncated part' }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'length' }] },
      ]);

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      const chunks: string[] = [];
      for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Truncated part']);
    });

    it('falls back to non-stream when stream body is null', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { role: 'assistant', content: 'Fallback answer' }, finish_reason: 'stop' }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      const chunks: string[] = [];
      for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Fallback answer']);
    });

    it('falls back to non-stream when stream produces no answer', async () => {
      const stream = makeSSE([
        { choices: [{ delta: {}, finish_reason: null }] },
      ]);

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response(stream, { status: 200 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { role: 'assistant', content: 'Retried answer' }, finish_reason: 'stop' }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      const chunks: string[] = [];
      for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Retried answer']);
    });

    it('reports stream timeout error when internal abort happens during stream', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new DOMException('Aborted', 'AbortError'));
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      ) as unknown as typeof fetch;

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      await expect(async () => {
        for await (const _ of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
          // iterate
        }
      }).rejects.toThrow('nvidia request timed out while streaming');
    });

    it('healthCheck returns ok: false when fetch rejects with error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection failure'));

      const provider = new OpenAICompatibleAIProvider(logger, nvidiaPreset, { model: 'test-model' });
      const result = await provider.healthCheck();
      expect(result).toEqual({ ok: false, detail: 'Connection failure' });
    });
  });
});

