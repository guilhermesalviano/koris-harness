import type { AIChatOptions, AIChatRequest, AIProvider, AIProviderOptions, AIResponse } from '../../../types/chat';
import { config } from '../../../config';
import { ILogger } from '../../../infrastructure/logger';
import { validateBaseUrl } from '../../../utils/provider';
import type { ProviderRegistration } from '../manifest';
import { THINK_START, THINK_END } from '../../../constants/thinking';
import { extractToolCalls } from '../../../utils/tool-calls';

type OllamaChatChunk = {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: Array<{ function: { name: string; arguments: string } }>;
  };
  response?: string;
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

type OllamaVersionResponse = {
  version?: string;
};

class OllamaAIProvider implements AIProvider {
  readonly name = 'ollama';
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly embeddingModel: string;
  private readonly embeddingEnabled: boolean;
  private readonly numCtx: number;

  constructor(private readonly logger: ILogger, opts?: AIProviderOptions) {
    const resolvedBaseUrl = (opts?.baseUrl?.trim() || config.AI.MANAGER.BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    this.baseUrl = validateBaseUrl(resolvedBaseUrl);
    this.defaultModel = opts?.model ?? config.AI.MANAGER.MODEL;
    this.embeddingModel = opts?.embeddingModel ?? config.AI.EMBED.MODEL;
    this.embeddingEnabled = opts?.embeddingEnabled ?? config.AI.EMBED.ENABLED;
    this.numCtx = opts?.numCtx ?? config.AI.WORKERS.NUM_CTX;
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
      this.logger.debug('Ollama chat request', {
        model: request.model ?? this.defaultModel,
        messagesCount: request.messages.length,
        hasTools: !!request.tools?.length,
      });

      const { content, promptEvalCount, evalCount } = await this.postChat(request, controller.signal);
      options?.onUsage?.({ inputTokens: promptEvalCount, outputTokens: evalCount });
      return content;
    } catch (err) {
      this.logger.error('Ollama chat error', {
        error: err instanceof Error ? err.message : String(err),
        cause: err instanceof Error ? (err as { cause?: unknown }).cause : undefined,
      });
      if (this.isAbortError(err)) {
        throw new Error(options?.signal?.aborted ? 'Ollama request aborted' : 'Ollama request timed out during non-stream /api/chat request');
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

    this.logger.debug('Ollama chatStream started', {
      model: request.model ?? this.defaultModel,
      messagesCount: request.messages.length,
      hasTools: !!request.tools?.length,
    });

    try {
      const res = await this.post(request, controller.signal, true);
      const body = res.body;

      if (!body) {
        this.logger.debug('Ollama stream body is null, falling back to non-stream');
        const { content: full, promptEvalCount, evalCount } = await this.postChat(request, controller.signal);
        options?.onUsage?.({ inputTokens: promptEvalCount, outputTokens: evalCount });
        totalCharsYielded = full.length;
        yield full;
        return;
      }

      let streamInThinking = false;
      let jsonBuffer = '';
      let producedAnswer = false;

      bumpIdle();
      for await (const chunk of this.readNDJSON(body, bumpIdle)) {
        totalChunksReceived++;
        if (chunk.error) throw new Error(chunk.error);

        const isThinking = !!(chunk.message?.thinking && !chunk.message?.content && !chunk.response);

        if (isThinking && !streamInThinking) {
          streamInThinking = true;
          yield THINK_START;
        } else if (!isThinking && streamInThinking) {
          streamInThinking = false;
          yield THINK_END;
        }

        if (isThinking) {
          const text = this.parseChunk(chunk);
          if (text) {
            totalCharsYielded += text.length;
            yield text;
          }
          continue;
        }

        if (chunk.done) {
          if (streamInThinking) yield THINK_END;

          if (chunk.prompt_eval_count != null || chunk.eval_count != null) {
            options?.onUsage?.({ inputTokens: chunk.prompt_eval_count, outputTokens: chunk.eval_count });
          }

          if (chunk.message?.tool_calls?.length) {
            const toolCallJson = JSON.stringify({ tool_calls: chunk.message.tool_calls });
            producedAnswer = true;
            totalCharsYielded += toolCallJson.length;
            yield toolCallJson;
          } else if (jsonBuffer) {
            const full = jsonBuffer + (this.parseChunk(chunk) ?? '');
            producedAnswer = true;
            totalCharsYielded += full.length;
            yield full;
          } else {
            const text = this.parseChunk(chunk);
            if (text) {
              producedAnswer = true;
              totalCharsYielded += text.length;
              yield text;
            }
          }
          break;
        }

        const text = this.parseChunk(chunk);
        if (text) {
          if (jsonBuffer || text.trimStart().startsWith('{')) {
            jsonBuffer += text;
          } else {
            producedAnswer = true;
            totalCharsYielded += text.length;
            yield text;
          }
        }
      }

      if (streamInThinking) {
        yield THINK_END;
      }

      if (!producedAnswer) {
        this.logger.debug('No answer parsed from stream, retrying in non-stream mode');
        const { content: full, promptEvalCount, evalCount } = await this.postChat(request, controller.signal);
        options?.onUsage?.({ inputTokens: promptEvalCount, outputTokens: evalCount });
        if (full) {
          totalCharsYielded += full.length;
          yield full;
        }
      }

      this.logger.info('Ollama chatStream complete', {
        model: request.model ?? this.defaultModel,
        chunksReceived: totalChunksReceived,
        charsYielded: totalCharsYielded,
      });
    } catch (err) {
      this.logger.error('Ollama chatStream error', {
        error: err instanceof Error ? err.message : String(err),
        cause: err instanceof Error ? (err as { cause?: unknown }).cause : undefined,
        chunksReceived: totalChunksReceived,
        charsYielded: totalCharsYielded,
      });

      if (this.isAbortError(err)) {
        if (options?.signal?.aborted) throw new Error('Ollama request aborted');
        throw new Error('Ollama request timed out while streaming');
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
      const res = await fetch(`${this.baseUrl}/api/version`, { signal: controller.signal });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };

      const data = await res.json() as OllamaVersionResponse;
      return { ok: true, detail: data.version ? `v${data.version}` : 'ok' };
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
      prompt: text
    });

    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    });

    if (!res.ok) {
      throw new Error(`Ollama /api/embeddings failed (${res.status})`);
    }

    const data = await res.json() as { embedding: number[] };
    return data.embedding;
  }

  private async postChat(
    request: AIChatRequest,
    signal: AbortSignal,
  ): Promise<{ content: string; promptEvalCount?: number; evalCount?: number }> {
    const res = await this.post(request, signal, false);
    const data = await res.json() as OllamaChatChunk;

    const usage = { promptEvalCount: data.prompt_eval_count, evalCount: data.eval_count };

    if (data.message?.tool_calls?.length && !data.message?.content?.trim()) {
      this.logger.debug('Tool calls in non-stream response', { count: data.message.tool_calls.length });
      return { content: JSON.stringify({ tool_calls: data.message.tool_calls }), ...usage };
    }

    const content = this.parseChunk(data);
    if (!content) {
      this.logger.warn('Ollama response content was empty, returning empty string', { data });
      return { content: '', ...usage };
    }
    return { content, ...usage };
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

  private async *readNDJSON(
    body: ReadableStream<Uint8Array>,
    onBump: () => void,
  ): AsyncGenerator<OllamaChatChunk> {
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
            const parsed = this.parseLine(line);
            if (parsed) yield parsed;
          }
        }
        if (done) break;
      }

      if (buffer.trim()) {
        const parsed = this.parseLine(buffer);
        if (parsed) yield parsed;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseLine(line: string): OllamaChatChunk | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const maybeSSE = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!maybeSSE || maybeSSE === '[DONE]') return null;

    try {
      return JSON.parse(maybeSSE) as OllamaChatChunk;
    } catch {
      return null;
    }
  }

  private parseChunk(chunk: OllamaChatChunk): string {
    if (chunk.message?.tool_calls?.length) return JSON.stringify({ tool_calls: chunk.message.tool_calls });
    if (chunk.message?.thinking && !chunk.message?.content) return chunk.message.thinking;
    return chunk.message?.content || chunk.response || '';
  }

  private isAbortError(err: unknown): boolean {
    return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
  }

  private async post(request: AIChatRequest, signal: AbortSignal, stream: boolean): Promise<Response> {
    const messages = request.messages.map((message) =>
      message.images?.length
        ? { ...message, images: message.images.map((image) => image.data) }
        : message,
    );

    const body = JSON.stringify({
      model: request.model ?? this.defaultModel,
      messages,
      tools: request.tools,
      keep_alive: '15m',
      options: {
        num_ctx: this.numCtx
      },
      stream
    });

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal,
    });

    this.logger.debug('Ollama /api/chat response', { status: res.status, stream, url: `${this.baseUrl}/api/chat` });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama /api/chat failed (${res.status}): ${text}`);
    }

    return res;
  }
}

class OllamaAIProviderFactory {
  static create(logger: ILogger, opts?: AIProviderOptions): AIProvider {
    return new OllamaAIProvider(logger, opts);
  }
}

export function providerManifest(): ProviderRegistration[] {
  return [{
    name: 'ollama',
    label: 'Ollama (local)',
    defaultBaseUrl: 'http://localhost:11434',
    docsUrl: 'https://ollama.com/library',
    embeddings: true,
    recommendedModel: 'gemma4:e4b',
    create: (logger: ILogger, opts?: AIProviderOptions) => OllamaAIProviderFactory.create(logger, opts),
  }];
}

export { OllamaAIProvider, OllamaAIProviderFactory };
