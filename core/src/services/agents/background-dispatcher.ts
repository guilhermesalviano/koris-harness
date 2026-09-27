import { config } from '../../config';
import { IDatabaseService } from '../../infrastructure/db-sqlite';
import { ILogger } from '../../infrastructure/logger';
import { ISessionManager } from '../session-manager';
import { IMemoryService } from '../memory-service';
import { ConversationWorkerFactory, ConversationWorkerProps } from '../workers/conversation-worker';
import { SummarizerFactory, SummarizerWorkerProps, CompactWorkerProps, CompactResult } from './sub-agents/summarizer/sub-agent';
import { ISubAgent } from '../../types/agents';
import { IWorker } from '../../types/workers';
import { ImageAttachment } from '../../types/messages';

interface PersistConversationProps {
  sessionId: string;
  ask: string;
  askImages?: ImageAttachment[];
  answer: string;
  /** When set, `answer` is a failed provider turn — flags the assistant row. */
  answerErrorCode?: string;
  channel: string;
}

interface SummarizeConversationProps extends PersistConversationProps {
  memoryService: IMemoryService;
}

interface IBackgroundDispatcher {
  persistConversation(props: PersistConversationProps): void;
  summarizeConversation(props: SummarizeConversationProps): void;
  compactConversation(props: CompactWorkerProps): Promise<CompactResult | null>;
}

class BackgroundDispatcher implements IBackgroundDispatcher {
  constructor(
    private logger: ILogger,
    private conversationWorker: IWorker<ConversationWorkerProps, void>,
    private summarizerWorker: ISubAgent<SummarizerWorkerProps> & { compact(props: CompactWorkerProps): Promise<CompactResult> },
  ) {}

  persistConversation(props: PersistConversationProps): void {
    this.conversationWorker.run(props)
      .catch((err: unknown) =>
        this.logger.error('Background conversation processing failed', { err })
      );
  }

  summarizeConversation(props: SummarizeConversationProps): void {
    if (config.SESSION.SUMMARIZER_MODE !== 'auto') return;
    if (props.answerErrorCode) return;
    if (!props.answer || !props.answer.trim()) return;

    this.summarizerWorker.handler(props)
      .catch((err: unknown) =>
        this.logger.error('Background summarizer failed', { err })
      );
  }

  async compactConversation(props: CompactWorkerProps): Promise<CompactResult | null> {
    if (!props.messages.length) return null;

    try {
      return await this.summarizerWorker.compact(props);
    } catch (err: unknown) {
      this.logger.error('Compaction failed', { err });
      return null;
    }
  }
}

class BackgroundDispatcherFactory {
  static create(logger: ILogger, db: IDatabaseService, sessionManager: ISessionManager): IBackgroundDispatcher {
    const conversationWorker = ConversationWorkerFactory.create(logger, db, sessionManager);
    const summarizerWorker = SummarizerFactory.create(logger);
    return new BackgroundDispatcher(logger, conversationWorker, summarizerWorker);
  }
}

export { IBackgroundDispatcher, BackgroundDispatcher, BackgroundDispatcherFactory };
