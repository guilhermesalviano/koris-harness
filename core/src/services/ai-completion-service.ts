import { config } from '../config';
import type { ILogger } from '../infrastructure/logger';
import type { AIChatOptions, AIChatRequest, AIProvider, AIResponse } from '../types/chat';
import { AuditLogLlm, type AuditRole } from '../entities/audit-log';
import { IAuditService, AuditServiceFactory } from './audit/audit-service';
import { generateId } from '../utils/generate-id';
import { HTTP_ERROR_MESSAGES } from '../constants';

export type AIErrorCode = 'aborted' | 'timeout' | 'authentication' | 'rate_limited' | 'unavailable' | 'malformed_response' | 'context_length' | 'unknown';

const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_BACKOFF_MS = 1000;

const HTTP_ERROR_CODES: Partial<Record<number, AIErrorCode>> = {
  400: 'malformed_response',
  401: 'authentication',
  403: 'authentication',
  404: 'unavailable',
  408: 'timeout',
  429: 'rate_limited',
  500: 'unavailable',
  502: 'unavailable',
  503: 'unavailable',
  504: 'timeout',
};

export class AIServiceError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    public readonly cause?: unknown,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'AIServiceError';
  }

  toJSON(): { code: AIErrorCode; statusCode?: number; message: string } {
    const payload: { code: AIErrorCode; statusCode?: number; message: string } = {
      code: this.code,
      message: this.message,
    };
    if (this.statusCode != null) payload.statusCode = this.statusCode;
    return payload;
  }
}

export interface IAICompletionService {
  complete(request: AIChatRequest, options?: AIChatOptions): Promise<AIResponse>;
}

/** Resolves the provider to use for a `complete()` call, invoked fresh each time
 * so a provider swapped in via the config UI takes effect without a restart. */
export type AIProviderResolver = () => AIProvider;

export interface AICompletionServiceOptions {
  role?: AuditRole;
  agentName?: string;
  auditService?: IAuditService;
  retry?: {
    attempts?: number;
    backoffMs?: number;
  };
}

export class AICompletionService implements IAICompletionService {
  private readonly role: AuditRole;
  private readonly agentName?: string;
  private readonly auditService: IAuditService;
  private readonly retryAttempts: number;
  private readonly retryBackoffMs: number;

  constructor(
    private readonly resolveProvider: AIProviderResolver,
    private readonly logger: ILogger,
    options?: AICompletionServiceOptions,
  ) {
    this.role = options?.role ?? 'manager';
    this.agentName = options?.agentName;
    this.auditService = options?.auditService ?? AuditServiceFactory.create(logger);
    this.retryAttempts = options?.retry?.attempts ?? DEFAULT_RETRY_ATTEMPTS;
    this.retryBackoffMs = options?.retry?.backoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
  }

  async complete(request: AIChatRequest, options?: AIChatOptions): Promise<AIResponse> {
    // Resolved once per call (not once per constructor) so a provider activated
    // in the config UI is picked up on the very next message, not just after a
    // restart. `getAIProvider()` itself caches by role/priority, so this stays
    // cheap until that cache is invalidated by a settings change.
    const provider = this.resolveProvider();
    const startedAt = Date.now();
    let attempt = 0;

    while (true) {
      attempt++;
      let usage: { inputTokens?: number; outputTokens?: number } | undefined;

      const providerOptions: AIChatOptions = {
        ...options,
        audit: { ...(options?.audit ?? {}), agentName: this.agentName },
        onUsage: (u) => { usage = u; },
      };

      try {
        const response = await provider.complete(request, providerOptions);
        this.recordAudit(request, options, Date.now() - startedAt, provider.name, response, undefined, usage);
        return response;
      } catch (error) {
        const mapped = this.mapError(error, options?.signal);
        const canRetry = !options?.signal?.aborted
          && (mapped.code === 'unavailable' || mapped.code === 'rate_limited')
          && attempt <= this.retryAttempts;

        if (canRetry) {
          const backoff = this.retryBackoffMs * (2 ** (attempt - 1));
          this.logger.warn('AI provider transient error, retrying', {
            provider: provider.name,
            attempt,
            retriesLeft: this.retryAttempts - attempt,
            error: mapped.message,
          });
          await this.sleep(backoff);
          continue;
        }

        this.recordAudit(request, options, Date.now() - startedAt, provider.name, undefined, mapped, usage);
        this.logger.error('AI completion failed', {
          provider: provider.name,
          code: mapped.code,
          statusCode: mapped.statusCode,
          error: mapped.message,
        });
        throw mapped;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private recordAudit(
    request: AIChatRequest,
    options: AIChatOptions | undefined,
    durationMs: number,
    providerName: string,
    response?: AIResponse,
    error?: AIServiceError,
    usage?: { inputTokens?: number; outputTokens?: number },
  ): void {
    const prompt = JSON.stringify(request.messages, (key, value) => {
      if (key === 'images' && Array.isArray(value)) {
        return value.map((image) => `[image:${image?.data?.length ?? 0} bytes]`);
      }
      return value;
    });
    const responseText = response
      ? response.kind === 'message'
        ? response.text
        : JSON.stringify(response.calls)
      : undefined;

    const entry: AuditLogLlm = {
      id: generateId(),
      type: 'llm',
      role: this.role,
      agentName: this.agentName,
      runId: options?.audit?.runId,
      sessionId: options?.audit?.sessionId,
      channel: options?.audit?.channel,
      provider: providerName,
      model: request.model ?? this.resolveDefaultModel(),
      prompt,
      promptLength: prompt.length,
      response: responseText,
      responseLength: responseText?.length,
      finishReason: response?.finishReason,
      toolCalls: response?.kind === 'tool_calls' ? response.calls.length : 0,
      toolsEnabled: (request.tools?.length ?? 0) > 0,
      durationMs,
      status: error ? 'error' : 'success',
      errorCode: error?.code,
      errorMessage: error?.message,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      createdAt: new Date(),
    };

    this.auditService.record(entry);
  }

  private resolveDefaultModel(): string {
    return this.role === 'worker' ? config.AI.WORKERS.MODEL : config.AI.MANAGER.MODEL;
  }

  private mapError(error: unknown, signal?: AbortSignal): AIServiceError {
    if (error instanceof AIServiceError) return error;

    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    const statusCode = this.extractStatusCode(message);

    const mappedMessage = statusCode != null ? HTTP_ERROR_MESSAGES[statusCode] : undefined;
    const userMessage = mappedMessage ?? message;

    if (signal?.aborted || normalized.includes('aborted')) {
      return new AIServiceError('aborted', userMessage, error, statusCode);
    }
    if (normalized.includes('timeout') || normalized.includes('timed out') || statusCode === 408 || statusCode === 504) {
      return new AIServiceError('timeout', userMessage, error, statusCode);
    }
    if (
      normalized.includes('context length') ||
      normalized.includes('context window') ||
      normalized.includes('maximum context') ||
      normalized.includes('too many tokens') ||
      normalized.includes('reduce the length') ||
      normalized.includes('reduce your prompt') ||
      normalized.includes('prompt is too long') ||
      statusCode === 413
    ) {
      return new AIServiceError('context_length', userMessage, error, statusCode);
    }
    if (statusCode != null && HTTP_ERROR_CODES[statusCode]) {
      return new AIServiceError(HTTP_ERROR_CODES[statusCode] as AIErrorCode, userMessage, error, statusCode);
    }
    if (normalized.includes('401') || normalized.includes('403') || normalized.includes('authentication')) {
      return new AIServiceError('authentication', userMessage, error, statusCode);
    }
    if (normalized.includes('429') || normalized.includes('rate limit')) {
      return new AIServiceError('rate_limited', userMessage, error, statusCode);
    }
    if (normalized.includes('missing content') || normalized.includes('missing choices')) {
      return new AIServiceError('malformed_response', userMessage, error, statusCode);
    }
    if (normalized.includes('fetch') || normalized.includes('unavailable') || normalized.includes('503')) {
      return new AIServiceError('unavailable', userMessage, error, statusCode);
    }
    return new AIServiceError('unknown', userMessage, error, statusCode);
  }

  private extractStatusCode(message: string): number | undefined {
    const match = message.match(/\((\d{3})\)/) ?? message.match(/HTTP (\d{3})/);
    if (!match) return undefined;
    const status = Number(match[1]);
    return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  }
}
