import { EXECUTOR_SYNTHESIS_RULES } from "../../constants";
import { ChatServiceFactory } from "../chat/chat-service";
import { IWorker } from "../../types/workers";
import { IChatService } from "../../types/chat";
import { ILogger } from "../../infrastructure/logger";
import type { ToolCall } from "../../types/tools";
import type { LoopContext } from "../../types/context";
import type { ProcessedMessage } from "../../types/agents";
import type { Message } from "../../types/messages";

interface ExecutorWorkerArgs {
  toolCalls: ToolCall[];
  userMessage: string;
  messageHistory: Message[];
  ctx: LoopContext;
  iteration?: number;
  maxIterations?: number;
}

class ExecutorWorker implements IWorker<ExecutorWorkerArgs, ProcessedMessage> {
  constructor(
    private logger: ILogger,
    public name: string,
    private workerChatService: IChatService,
    private managerChatService: IChatService,
  ) { }

  async run(args: ExecutorWorkerArgs): Promise<ProcessedMessage> {
    const { toolCalls, userMessage, messageHistory, ctx, iteration = 1, maxIterations = 10 } = args;

    if (iteration >= maxIterations) {
      this.logger.warn('Max tool iterations reached', {
        maxIterations,
        userMessage
      });
      return `Maximum tool execution iterations (${maxIterations})`+
        ` reached. Please try rephrasing your request.`;
    }
    ctx.onProgress(`Iteration ${iteration}`);

    this.logger.info('Executing tools...', { toolCalls });

    const toolResultsArray = await ctx.toolsQueue.handle(
      toolCalls,
      ctx.signal,
      {
        channel: ctx.channel,
        sessionId: ctx.message?.getSessionId(),
        runId: ctx.options?.runId,
        agentName: 'executorWorker',
        ...ctx.toolContext,
      },
    );

    const allSilentSuccess = toolResultsArray.length > 0
      && toolResultsArray.every((r) => r.success && r.silent);
    if (allSilentSuccess) {
      this.logger.info('Silent tool result(s); skipping synthesis call', {
        toolNames: toolResultsArray.map((r) => r.toolName),
      });
      return '';
    }

    const toolResults = toolResultsArray.map((r) => ({
      role: 'tool' as const,
      content: r.success
        ? `Tool: ${r.toolName}, Result: ${r.result}`
        : `Tool: ${r.toolName}, Success: ${r.success}, Error: ${r.error}`,
      tool_call_id: r.toolCallId,
    }));
    this.logger.info(`Tool results: ${toolResults.map((r) => r.content).join('\n')}`);

    const toolMessages: Message[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          function: { name: tc.name, arguments: tc.arguments },
          ...(tc.extraContent ? { extraContent: tc.extraContent } : {}),
        })),
      },
      ...toolResults,
    ];

    const isBackground = ctx.initiatedBy === 'heartbeat' || ctx.initiatedBy === 'summarizer';
    const chatService = isBackground ? this.workerChatService : this.managerChatService;
    const response = await chatService.complete(
      userMessage,
      ctx.channel,
      ctx.options,
      messageHistory,
      ctx.message?.getSessionId(),
      [EXECUTOR_SYNTHESIS_RULES],
      toolMessages,
      ctx.images,
    );

    if (response.kind === 'message') return response.text;

    const nextToolCalls = response.calls;
    if (nextToolCalls.length === 0) return '';

    this.logger.info(`Tool call (${nextToolCalls.length}) after execution phase`, { toolCalls: nextToolCalls });

    return this.run({
      toolCalls: nextToolCalls,
      userMessage,
      messageHistory,
      ctx,
      iteration: iteration + 1,
      maxIterations,
    }
    );
  }
}

class ExecutorWorkerFactory {
  static create(logger: ILogger): IWorker<ExecutorWorkerArgs, ProcessedMessage> {
    const workerChatService = ChatServiceFactory.create(logger, 'worker', 'executorWorker');
    const managerChatService = ChatServiceFactory.create(logger, 'manager', 'executorWorker');
    return new ExecutorWorker(logger, 'executorWorker', workerChatService, managerChatService);
  }
}

export { ExecutorWorkerArgs, ExecutorWorker, ExecutorWorkerFactory };