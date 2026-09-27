import type { AIChatOptions, AIChatRequest, AIProvider, AIResponse } from '../../types/chat';
import { SerialQueue, sharedSerialQueue } from './serial-queue';

class SerialAIProvider implements AIProvider {
  readonly name: string;
  private readonly queue: SerialQueue;
  private readonly priority: number;
  private readonly label: string;

  constructor(private readonly inner: AIProvider, queue?: SerialQueue, priority = 0, label = '') {
    this.name = inner.name;
    this.queue = queue ?? sharedSerialQueue;
    this.priority = priority;
    this.label = label || inner.name;
  }

  complete(request: AIChatRequest, options?: AIChatOptions): Promise<AIResponse> {
    return this.queue.run(
      () => this.inner.complete(request, options),
      this.priority,
      options?.audit?.agentName ?? this.label,
    );
  }

  chat(request: AIChatRequest, options?: AIChatOptions): Promise<string> {
    return this.queue.run(
      () => this.inner.chat(request, options),
      this.priority,
      options?.audit?.agentName ?? this.label,
    );
  }

  async *chatStream(request: AIChatRequest, options?: AIChatOptions): AsyncGenerator<string> {
    const release = await this.queue.acquire(this.priority, options?.audit?.agentName ?? this.label);
    try {
      for await (const chunk of this.inner.chatStream(request, options)) {
        yield chunk;
      }
    } finally {
      release();
    }
  }

  embed(text: string): Promise<number[]> {
    return this.queue.run(() => this.inner.embed(text), this.priority, this.label);
  }

  healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return this.inner.healthCheck();
  }
}

export { SerialAIProvider };