import { IDatabaseService } from '../../infrastructure/db-sqlite';
import { ILogger } from '../../infrastructure/logger';
import { MessageServiceFactory, IMessageService } from '../message-service';
import { MemoryServiceFactory, IMemoryService } from '../memory-service';
import { ISessionManager } from '../session-manager';
import { ISessionService } from '../session-service';
import { SessionKey } from '../../types/session';

export interface SessionContext {
  sessionService: ISessionService;
  messageService: IMessageService;
  memoryService: IMemoryService;
}

export interface ISessionContextFactory {
  resolve(origin: SessionKey, sessionId?: string): SessionContext;
}

class SessionContextResolver implements ISessionContextFactory {
  constructor(
    private logger: ILogger,
    private db: IDatabaseService,
    private sessionManager: ISessionManager,
  ) {}

  resolve(origin: SessionKey, sessionId?: string): SessionContext {
    const sessionService = this.resolveSessionService(origin, sessionId);
    return {
      sessionService,
      messageService: MessageServiceFactory.create(this.db, sessionService),
      memoryService: MemoryServiceFactory.create(this.db, sessionService),
    };
  }

  private resolveSessionService(origin: SessionKey, sessionId?: string): ISessionService {
    if (!sessionId) {
      return this.sessionManager.getSessionService(origin);
    }

    try {
      return this.sessionManager.getSessionServiceById(sessionId);
    } catch (err) {
      this.logger.warn(`Session "${sessionId}" not found, falling back to initiated channel session`, { origin, err });
      return this.sessionManager.getSessionService(origin);
    }
  }
}

class SessionContextFactory {
  static create(logger: ILogger, db: IDatabaseService, sessionManager: ISessionManager): ISessionContextFactory {
    return new SessionContextResolver(logger, db, sessionManager);
  }
}

export { SessionContextResolver, SessionContextFactory };
