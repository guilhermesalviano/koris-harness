import type { ILogger } from "../../infrastructure/logger";
import { IWorker } from "../../types/workers";
import { MessageServiceFactory } from "../message-service";
import { ISessionManager } from "../session-manager";
import { IDatabaseService } from "../../infrastructure/db-sqlite";
import { ImageAttachment } from "../../types/messages";

interface ConversationWorkerProps {
  sessionId: string,
  ask: string,
  askImages?: ImageAttachment[],
  answer: string,
  /** When set, `answer` is a failed provider turn — stored on the assistant row. */
  answerErrorCode?: string,
  channel: string,
}

class ConversationWorker implements IWorker<ConversationWorkerProps, void> {
  constructor(
    private logger: ILogger,
    public name: string = 'conversationWorker',
    private db: IDatabaseService,
    private sessionManager: ISessionManager
  ) { }

  async run(
    props: ConversationWorkerProps
  ): Promise<void> {
    const { sessionId, ask, askImages, answer, answerErrorCode, channel } = props;

    this.logger.info(`Conversation worker started for session ${sessionId} in ${channel}`);

    try {
      const sessionService = this.sessionManager.getSessionServiceById(sessionId);
      const messageService = MessageServiceFactory.create(this.db, sessionService);
      messageService.save({ role: 'user', content: ask, images: askImages });
      messageService.save({ role: 'assistant', content: answer, errorCode: answerErrorCode });
      this.logger.info(`Conversation worker completed for session ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to process conversation for session ${sessionId}`, { error });
    }
  }
}

class ConversationWorkerFactory {
  static create(logger: ILogger, db: IDatabaseService, sessionManager: ISessionManager): IWorker<ConversationWorkerProps, void> {
    return new ConversationWorker(logger, 'conversationWorker', db, sessionManager);
  }
}

export { ConversationWorkerProps, ConversationWorkerFactory };
