import { Message } from "../entities/message";
import { IDatabaseService } from "../infrastructure/db-sqlite";
import { IMessageRepository, MessageRepositoryFactory } from "../repositories/message";
import { MessageRole, ImageAttachment } from "../types/messages";
import { ISessionService } from "./session-service";
import type { AgentId } from '../constants/agents';

interface IMessageService {
  save(props: { role: MessageRole; content: string; images?: ImageAttachment[]; errorCode?: string; senderAgentId?: AgentId }): void;
  getHistory(): Message[];
  getSessionId(): string;
  getSessionMetadata(): Record<string, unknown>;
}

class MessageService implements IMessageService {
  private messageRepository: IMessageRepository;
  private session: ISessionService;

  constructor(messageRepository: IMessageRepository, session: ISessionService) {
    this.messageRepository = messageRepository;
    this.session = session;
  }

  save(props: { role: MessageRole; content: string; images?: ImageAttachment[]; errorCode?: string; senderAgentId?: AgentId }) {
    this.session.ensureActiveSession();
    const message = new Message({
      sessionId: this.session.getSession().id,
      role: props.role,
      content: props.content,
      senderAgentId: props.senderAgentId,
      images: props.images,
      errorCode: props.errorCode,
    });
    this.messageRepository.save(message);
    this.session.updateCount();
  }

  getHistory(): Message[] {
    this.session.ensureActiveSession();
    const session = this.session.getSession();
    return this.messageRepository.getBySessionId(session.id);
  }

  getSessionId(): string {
    return this.session.getSession().id;
  }

  getSessionMetadata(): Record<string, unknown> {
    return this.session.getSession().metadata;
  }
}

class MessageServiceFactory {
  public static create(db: IDatabaseService, sessionService: ISessionService): MessageService {
    const messageRepository = MessageRepositoryFactory.create(db);

    return new MessageService(messageRepository, sessionService);
  }
}

export { IMessageService, MessageService, MessageServiceFactory }
