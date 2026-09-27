import { getAIProvider } from "../providers";
import type { AuditRole } from "../../entities/audit-log";
import { ILogger } from "../../infrastructure/logger";
import { IPromptRepository, PromptRepositoryFactory } from "../../repositories/prompt";
import { ProcessedMessage, ProcessOptions } from "../../types/agents";
import { DatabaseServiceFactory } from "../../infrastructure/db-sqlite";
import { AICompletionService, IAICompletionService } from "../ai-completion-service";
import type { AIResponse, IChatService } from "../../types/chat";
import type { Message } from "../../entities/message";
import type { ImageAttachment } from "../../types/messages";

class ChatService implements IChatService {
  constructor(
    private readonly completionService: IAICompletionService,
    private readonly promptRepository: IPromptRepository,
  ) { }

  async complete(
    message: string,
    channel: string,
    options?: ProcessOptions,
    messageHistory?: Message[],
    sessionId?: string,
    extraSystemBlocks?: string[],
    toolResults?: Message[],
    images?: ImageAttachment[],
  ): Promise<AIResponse> {
    const messagesHistory = messageHistory?.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.images?.length ? { images: m.images } : {}),
    }));
    const promptPayload = await this.promptRepository.build({
      userMessage: message,
      images,
      channel,
      toolsEnabled: options?.toolsEnabled,
      learnedSkillsEnabled: options?.learnedSkillsEnabled,
      messageHistory: messagesHistory,
      sessionId,
      extraSystemBlocks,
      toolResults,
    });

    return this.completionService.complete(promptPayload, {
      signal: options?.signal,
      audit: { channel, sessionId, runId: options?.runId },
    });
  }

  async handler(
    message: string,
    channel: string,
    options?: ProcessOptions,
    messageHistory?: Message[],
    sessionId?: string
  ): Promise<ProcessedMessage> {
    const response = await this.complete(message, channel, options, messageHistory, sessionId);
    if (response.kind === 'message') return response.text;
    return JSON.stringify({
      tool_calls: response.calls.map(call => ({
        function: { name: call.name, arguments: call.arguments },
      })),
    });
  }
}

class ChatServiceFactory {
  static create(logger: ILogger, role: AuditRole = 'manager', agentName?: string): IChatService {
    const db = DatabaseServiceFactory.create();
    const promptRepository = PromptRepositoryFactory.create(db, logger, getAIProvider(logger, 'embed'));
    // Resolved lazily so a provider activated for `role` in the config UI
    // takes effect on the next message, not just after a process restart.
    const completionService = new AICompletionService(() => getAIProvider(logger, role), logger, { role, agentName });
    return new ChatService(completionService, promptRepository);
  }
}

export { ChatService, ChatServiceFactory };
