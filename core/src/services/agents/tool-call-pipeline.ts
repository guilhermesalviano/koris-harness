import type { ILogger } from '../../infrastructure/logger';
import type { Message } from '../../entities/message';
import type { LoopContext } from '../../types/context';
import type { ToolCall } from '../../types/tools';
import type { ProcessedMessage } from '../../types/agents';
import type { IWorker } from '../../types/workers';
import { ExecutorWorkerFactory, ExecutorWorkerArgs } from '../workers/executor-worker';

interface IToolCallPipeline {
  execute(
    callbacks: ToolCall[],
    userMessage: string,
    messageHistory: Message[],
    ctx: LoopContext,
  ): Promise<ProcessedMessage>;
}

class ToolCallPipeline implements IToolCallPipeline {
  constructor(
    private executor: IWorker<ExecutorWorkerArgs, ProcessedMessage>,
  ) {}

  async execute(
    callbacks: ToolCall[],
    userMessage: string,
    messageHistory: Message[],
    ctx: LoopContext,
  ): Promise<ProcessedMessage> {
    if (callbacks.length === 0) {
      ctx.onProgress('No tools to execute');
      return '';
    }

    ctx.onProgress(`Execution phase: ${callbacks.length} tool(s) - ${callbacks.map(c => c.name).join(' - ')}`);
    return this.executor.run({ toolCalls: callbacks, userMessage, messageHistory, ctx });
  }
}

class ToolCallPipelineFactory {
  static create(logger: ILogger): IToolCallPipeline {
    const executor = ExecutorWorkerFactory.create(logger);
    return new ToolCallPipeline(executor);
  }
}

export { IToolCallPipeline, ToolCallPipeline, ToolCallPipelineFactory };