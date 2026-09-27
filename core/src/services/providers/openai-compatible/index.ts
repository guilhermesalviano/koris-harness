import type { AIChatOptions, AIChatRequest, AIProvider, AIProviderOptions, AIResponse } from '../../../types/chat';
import type { Message } from '../../../types/messages';
import { config } from '../../../config';
import { ILogger } from '../../../infrastructure/logger';
import { THINK_START, THINK_END } from '../../../constants/thinking';
import { extractToolCalls } from '../../../utils/tool-calls';
import type { ProviderRegistration } from '../manifest';
import { OPENAI_COMPATIBLE_PRESETS, type OpenAICompatiblePreset } from './presets';

type OpenAIContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type OpenAIMessage = {
  role: string;
  content?: string | null | OpenAIContentBlock[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
};

type OpenAIToolCall = {
  id?: string;
  index?: number;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
  /** Provider data to echo back with the call, e.g. Gemini's `google.thought_signature`. */
  extra_content?: Record<string, unknown>;
};

type OpenAIChatResponse = {
  id?: string;
  choices?: Array<{
    message?: OpenAIMessage;
    finish_reason?: string | null;
  }>;
  error?: { message: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

type OpenAIChatChunk = {
  id?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason?: string | null;
  }>;
  error?: { message: string };
};

/** Accumulated tool call state during streaming */
type ToolCallAccumulator = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  extra_content?: Record<string, unknown>;
};

class OpenAICompatibleAIProvider implements AIProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly embeddingModel: string;
  private readonly embeddingEnabled: boolean;
  private readonly apiToken: string;
  private readonly numCtx?: number;

  constructor(
    private readonly logger: ILogger,
    private readonly preset: OpenAICompatiblePreset,
    opts?: AIProviderOptions,
  ) {
    this.name = preset.name;
    this.baseUrl = (opts?.baseUrl?.trim() || preset.baseUrl).replace(/\/+$/, '');
    this.defaultModel = opts?.model ?? config.AI.MANAGER.MODEL;
    this.embeddingModel = opts?.embeddingModel ?? config.AI.EMBED.MODEL;
    this.embeddingEnabled = opts?.embeddingEnabled ?? config.AI.EMBED.ENABLED;
    this.apiToken = opts?.apiToken ?? config.AI.MANAGER.API_TOKEN;
    this.numCtx = opts?.numCtx;
  }

  async complete(request: AIChatRequest, options?: AIChatOptions): Promise<AIResponse> {
    const text = await this.chat(request, options);
    const calls = extractToolCalls(text, this.logger);
    return calls.length > 0
      ? { kind: 'tool_calls', calls, finishReason: 'tool_calls' }
      : { kind: 'message', text, finishReason: 'stop' };
  }

  async chat(request: AIChatRequest, options?: AIChatOptions): Promise<string> {
    const { controller, cleanup } = this.makeController(options?.signal);
    try {
      this.logger.debug(`${this.name} chat request`, {
        model: request.model ?? this.defaultModel,
        messagesCount: request.messages.length,
        hasTools: !!request.tools?.length,
      });

      const res = await this.post(request, controller.signal, false);
      const data = await res.json() as OpenAIChatResponse;

      if (data.error) throw new Error(`${this.name} API error: ${data.error.message}`);

      if (data.usage) {
        options?.onUsage?.({
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        });
      }

      const choice = data.choices?.[0];
      if (!choice) throw new Error(`${this.name} response missing choices`);

      const msg = choice.message;
      // Use finish_reason to detect tool calls — model may return both content and tool_calls.
      if (choice.finish_reason === 'tool_calls' && msg?.tool_calls?.length) {
        this.logger.debug(`Tool calls in ${this.name} non-stream response`, { count: msg.tool_calls.length });
        return JSON.stringify({ tool_calls: msg.tool_calls });
      }

      const content = typeof msg?.content === 'string' ? msg.content : null;
      if (!content) throw new Error(`${this.name} response missing content`);
      return content;
    } catch (err) {
      this.logger.error(`${this.name} chat error`, { error: err instanceof Error ? err.message : String(err) });
      if (this.isAbortError(err)) {
        throw new Error(options?.signal?.aborted ? `${this.name} request aborted` : `${this.name} request timed out`);
      }
      throw err;
    } finally {
      cleanup();
    }
  }

  async *chatStream(request: AIChatRequest, options?: AIChatOptions): AsyncGenerator<string> {
    const { controller, cleanup } = this.makeController(options?.signal);

    let idleTimer: NodeJS.Timeout | undefined;
    const bumpIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), config.AI.TIMEOUTS.IDLE_MS);
    };

    let totalChunksReceived = 0;
    let totalCharsYielded = 0;

    this.logger.debug(`${this.name} chatStream started`, {
      model: request.model ?? this.defaultModel,
      messagesCount: request.messages.length,
      hasTools: !!request.tools?.length,
    });

    try {
      const res = await this.post(request, controller.signal, true);
      const body = res.body;

      if (!body) {
        this.logger.debug(`${this.name} stream body is null, falling back to non-stream`);
        const full = await this.chatFallback(request, controller.signal, options);
        totalCharsYielded = full.length;
        yield full;
        return;
      }

      const toolCallAccumulator = new Map<number, ToolCallAccumulator>();
      let streamInThinking = false;
      let producedAnswer = false;
      const textBuffer: string[] = [];

      bumpIdle();
      for await (const chunk of this.readSSE(body, bumpIdle)) {
        totalChunksReceived++;
        if (chunk.error) throw new Error(`${this.name} stream error: ${chunk.error.message}`);

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta ?? {};

        // Reasoning/thinking content (some models)
        if (delta.reasoning_content) {
          if (!streamInThinking) {
            streamInThinking = true;
            yield THINK_START;
          }
          totalCharsYielded += delta.reasoning_content.length;
          yield delta.reasoning_content;
          continue;
        }

        if (streamInThinking && delta.content != null) {
          streamInThinking = false;
          yield THINK_END;
        }

        // Accumulate streamed tool calls
        if (delta.tool_calls?.length) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallAccumulator.has(idx)) {
              toolCallAccumulator.set(idx, {
                id: tc.id ?? '',
                type: 'function',
                function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' },
                ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
              });
            } else {
              const acc = toolCallAccumulator.get(idx)!;
              if (tc.id) acc.id = tc.id;
              if (tc.extra_content) acc.extra_content = tc.extra_content;
              if (tc.function?.name) acc.function.name += tc.function.name;
              if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
            }
          }
        }

        // Buffer text content — we must wait for finish_reason to know if tools follow.
        if (delta.content) {
          textBuffer.push(delta.content);
        }

        if (choice.finish_reason === 'tool_calls') {
          // Tool call response: discard any buffered text, yield only tool call JSON.
          if (streamInThinking) { yield THINK_END; streamInThinking = false; }

          if (toolCallAccumulator.size > 0) {
            const toolCalls = Array.from(toolCallAccumulator.values());
            const json = JSON.stringify({ tool_calls: toolCalls });
            producedAnswer = true;
            totalCharsYielded += json.length;
            yield json;
          }
          break;
        }

        if (choice.finish_reason === 'stop' || choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') {
          // Text response: flush buffered content.
          if (streamInThinking) { yield THINK_END; streamInThinking = false; }

          for (const t of textBuffer) {
            producedAnswer = true;
            totalCharsYielded += t.length;
            yield t;
          }
          break;
        }
      }

      if (streamInThinking) yield THINK_END;

      if (!producedAnswer) {
        this.logger.debug(`No answer parsed from ${this.name} stream, retrying in non-stream mode`);
        const full = await this.chatFallback(request, controller.signal, options);
        if (full) {
          totalCharsYielded += full.length;
          yield full;
        }
      }

      this.logger.info(`${this.name} chatStream complete`, {
        model: request.model ?? this.defaultModel,
        chunksReceived: totalChunksReceived,
        charsYielded: totalCharsYielded,
      });
    } catch (err) {
      this.logger.error(`${this.name} chatStream error`, {
        error: err instanceof Error ? err.message : String(err),
        chunksReceived: totalChunksReceived,
        charsYielded: totalCharsYielded,
      });

      if (this.isAbortError(err)) {
        if (options?.signal?.aborted) throw new Error(`${this.name} request aborted`);
        throw new Error(`${this.name} request timed out while streaming`);
      }
      throw err;
    } finally {
      clearTimeout(idleTimer);
      cleanup();
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.AI.TIMEOUTS.HEALTH_MS);
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.authHeaders(),
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      return { ok: true, detail: 'ok' };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : 'unknown error' };
    } finally {
      clearTimeout(timer);
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.embeddingEnabled) {
      throw new Error('Embeddings are disabled in configuration');
    }

    const body = JSON.stringify({
      model: this.embeddingModel,
      input: text,
      input_type: 'query'
    });

    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.authHeaders(),
      body
    });

    if (!res.ok) {
      throw new Error(`${this.name} /embeddings failed (${res.status})`);
    }

    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }

  private async chatFallback(request: AIChatRequest, signal: AbortSignal, options?: AIChatOptions): Promise<string> {
    const res = await this.post(request, signal, false);
    const data = await res.json() as OpenAIChatResponse;

    if (data.error) throw new Error(`${this.name} API error: ${data.error.message}`);

    if (data.usage) {
      options?.onUsage?.({
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      });
    }

    const choice = data.choices?.[0];
    if (!choice) throw new Error(`${this.name} response missing choices`);

    const msg = choice.message;
    if (choice.finish_reason === 'tool_calls' && msg?.tool_calls?.length) {
      return JSON.stringify({ tool_calls: msg.tool_calls });
    }

    const content = typeof msg?.content === 'string' ? msg.content : null;
    if (!content) throw new Error(`${this.name} response missing content`);
    return content;
  }

  private makeController(outerSignal?: AbortSignal): { controller: AbortController; cleanup: () => void } {
    const controller = new AbortController();
    const hardTimer = setTimeout(() => controller.abort(), config.AI.TIMEOUTS.HARD_MS);

    if (!outerSignal) return { controller, cleanup: () => clearTimeout(hardTimer) };
    if (outerSignal.aborted) {
      controller.abort(outerSignal.reason);
      return { controller, cleanup: () => clearTimeout(hardTimer) };
    }

    const onAbort = () => controller.abort(outerSignal.reason);
    outerSignal.addEventListener('abort', onAbort, { once: true });
    return {
      controller,
      cleanup: () => {
        clearTimeout(hardTimer);
        outerSignal.removeEventListener('abort', onAbort);
      },
    };
  }

  private async *readSSE(
    body: ReadableStream<Uint8Array>,
    onBump: () => void,
  ): AsyncGenerator<OpenAIChatChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        const text = decoder.decode(value ?? new Uint8Array(), { stream: !done });
        if (text) {
          onBump();
          buffer += text;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const parsed = this.parseSSELine(line);
            if (parsed) yield parsed;
          }
        }
        if (done) break;
      }

      if (buffer.trim()) {
        const parsed = this.parseSSELine(buffer);
        if (parsed) yield parsed;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseSSELine(line: string): OpenAIChatChunk | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!data || data === '[DONE]') return null;

    try {
      return JSON.parse(data) as OpenAIChatChunk;
    } catch {
      return null;
    }
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiToken) headers['Authorization'] = `Bearer ${this.apiToken}`;
    if (this.preset.extraHeaders) Object.assign(headers, this.preset.extraHeaders);
    return headers;
  }

  private async post(request: AIChatRequest, signal: AbortSignal, stream: boolean): Promise<Response> {
    const body: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      messages: request.messages.map((message) => this.toOpenAIMessage(message)),
      stream,
    };

    if (request.tools?.length) body['tools'] = request.tools;
    if (request.temperature != null) body['temperature'] = request.temperature;
    // Configured context size doubles as the per-request output cap. Without it
    // some providers (e.g. OpenRouter) reserve the model's full context window
    // for their credit pre-check and reject the request.
    if (typeof this.numCtx === 'number' && this.numCtx > 0) body['max_tokens'] = this.numCtx;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
      signal,
    });

    this.logger.debug(`${this.name} /chat/completions response`, {
      status: res.status,
      stream,
      url: `${this.baseUrl}/chat/completions`,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const model = String(body['model'] ?? '');
      if (res.status === 404 && this.preset.notFoundHint) {
        const hint = this.preset.notFoundHint({ model, baseUrl: this.baseUrl, body: text });
        if (hint) throw new Error(hint);
      }
      const suffix = this.preset.hint ? ` — ${this.preset.hint}` : '';
      throw new Error(`${this.name} /chat/completions failed (${res.status}): ${text}${suffix}`);
    }

    return res;
  }

  private isAbortError(err: unknown): boolean {
    return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
  }

  private toOpenAIMessage(message: Message): OpenAIMessage {
    const openAIMessage: OpenAIMessage = message.images?.length
      ? { role: message.role, content: this.toContentBlocks(message) }
      : { ...message } as OpenAIMessage;

    if (message.tool_call_id) openAIMessage.tool_call_id = message.tool_call_id;

    // The shared Message keeps tool-call arguments as a parsed object (Ollama's
    // native shape); the OpenAI spec requires a JSON string plus `type`, and
    // strict endpoints (Gemini) reject objects with a 400 "Value is not a string".
    // Gemini also requires each call's `extra_content` (its thought_signature)
    // back verbatim, or it rejects the turn with a 400.
    if (message.tool_calls?.length) {
      openAIMessage.tool_calls = message.tool_calls.map((tc) => ({
        ...(tc.id ? { id: tc.id } : {}),
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments ?? {}),
        },
        ...(tc.extraContent ? { extra_content: tc.extraContent } : {}),
      }));
    }

    return openAIMessage;
  }

  private toContentBlocks(message: Message): OpenAIContentBlock[] {
    return [
      { type: 'text', text: message.content },
      ...(message.images ?? []).map((image) => ({
        type: 'image_url' as const,
        image_url: {
          url: `data:${image.mimeType ?? 'image/png'};base64,${image.data}`,
        },
      })),
    ];
  }
}

class OpenAICompatibleAIProviderFactory {
  static create(logger: ILogger, preset: OpenAICompatiblePreset, opts?: AIProviderOptions): AIProvider {
    return new OpenAICompatibleAIProvider(logger, preset, opts);
  }
}

export function providerManifest(): ProviderRegistration[] {
  return OPENAI_COMPATIBLE_PRESETS.map((preset) => ({
    name: preset.name,
    defaultBaseUrl: preset.baseUrl,
    isOpenAICompatible: true,
    label: preset.label,
    docsUrl: preset.docsUrl,
    apiKeyUrl: preset.apiKeyUrl,
    embeddings: preset.embeddings,
    recommendedModel: preset.recommendedModel,
    create: (logger: ILogger, opts?: AIProviderOptions) =>
      OpenAICompatibleAIProviderFactory.create(logger, preset, opts),
  }));
}

export { OpenAICompatibleAIProvider, OpenAICompatibleAIProviderFactory };
