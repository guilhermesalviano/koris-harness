import { ILogger } from '../../../infrastructure/logger';
import type { AIChatOptions, AIChatRequest, AIProvider, AIProviderOptions, AIResponse } from '../../../types/chat';
import type { ProviderRegistration } from '../manifest';

class MockAIProvider implements AIProvider {
  readonly name: string;
  private readonly logger: ILogger;

  constructor(logger: ILogger, name: string = 'mock') {
    this.logger = logger;
    this.name = name;
  }

  async complete(request: AIChatRequest, options?: AIChatOptions): Promise<AIResponse> {
    return { kind: 'message', text: await this.chat(request, options), finishReason: 'stop' };
  }

  async chat(request: AIChatRequest, _options?: AIChatOptions): Promise<string> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const prompt = lastUser?.content || '';
    
    this.logger.debug('Mock provider chat request', { 
      messagesCount: request.messages.length,
      hasTools: !!request.tools?.length,
    });
    
    const response = `I received your message: "${prompt}"\n\n(Using mock AI provider — set AI_PROVIDER=ollama to enable Ollama.)`;
    
    this.logger.info('Mock provider chat response', {
      responseLength: response.length,
    });
    
    return response;
  }

  async *chatStream(request: AIChatRequest, options?: AIChatOptions): AsyncGenerator<string> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const prompt = lastUser?.content || '';
    
    this.logger.debug('Mock provider chatStream started', { 
      messagesCount: request.messages.length,
      hasTools: !!request.tools?.length,
    });
    
    const response = `I received your message: "${prompt}"\n\n(Using mock AI provider — set AI_PROVIDER=ollama to enable Ollama.)`;

    for (const char of response) {
      if (options?.signal?.aborted) return;
      yield char;
    }
    
    this.logger.info('Mock provider chatStream complete', {
      responseLength: response.length,
    });
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    this.logger.debug('Mock provider health check');
    return { ok: true, detail: 'mock provider' };
  }

  async embed(text: string): Promise<number[]> {
    this.logger.debug('Mock provider embed', { textLength: text.length });
    return new Array(768).fill(0);
  }
}

class MockAIProviderFactory {
  static create(logger: ILogger, opts?: AIProviderOptions | string): AIProvider {
    const name = typeof opts === 'string' ? opts : 'mock';
    return new MockAIProvider(logger, name);
  }
}

export function providerManifest(): ProviderRegistration[] {
  return [{
    name: 'mock',
    create: (logger: ILogger) => MockAIProviderFactory.create(logger),
  }];
}

export { MockAIProvider, MockAIProviderFactory };