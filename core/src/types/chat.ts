import type { Message, ImageAttachment } from "./messages";
import type { ProcessedMessage, ProcessOptions } from "./agents";
import type { ToolCall } from "./tools";

export type AIRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AIChatRequest {
  model?: string;
  messages: Message[];
  temperature?: number;
  tools?: AIToolDefinition[];
  /** When true, instructs the provider to emit a thinking/reasoning block. */
  think?: boolean;
}

export interface AIChatOptions {
  signal?: AbortSignal;
  audit?: {
    runId?: string;
    sessionId?: string;
    channel?: string;
    agentName?: string;
  };
  onUsage?: (usage: { inputTokens?: number; outputTokens?: number }) => void;
}

export interface AIProviderOptions {
  baseUrl?: string;
  model?: string;
  apiToken?: string;
  embeddingModel?: string;
  embeddingEnabled?: boolean;
  numCtx?: number;
}

export type AIFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown';

export type AIResponse =
  | { kind: 'message'; text: string; finishReason: AIFinishReason }
  | { kind: 'tool_calls'; calls: ToolCall[]; finishReason: 'tool_calls' };

export type AIStreamEvent =
  | { kind: 'reasoning_delta'; text: string }
  | { kind: 'text_delta'; text: string }
  | { kind: 'tool_calls'; calls: ToolCall[] }
  | { kind: 'completed'; finishReason: AIFinishReason };

export interface ProviderHealth {
  ok: boolean;
  detail?: string;
}

export interface AIProvider {
  readonly name: string;
  complete(request: AIChatRequest, options?: AIChatOptions): Promise<AIResponse>;
  chat(request: AIChatRequest, options?: AIChatOptions): Promise<string>;
  chatStream(request: AIChatRequest, options?: AIChatOptions): AsyncGenerator<string>;
  embed(text: string): Promise<number[]>;
  healthCheck(): Promise<ProviderHealth>;
}

export interface IChatService {
  complete(
    message: string,
    channel: string,
    options?: ProcessOptions,
    messageHistory?: Message[],
    sessionId?: string,
    extraSystemBlocks?: string[],
    toolResults?: Message[],
    images?: ImageAttachment[],
  ): Promise<AIResponse>;

  handler(
    message: string,
    channel: string,
    options?: ProcessOptions,
    messageHistory?: Message[]
  ): Promise<ProcessedMessage>;
}