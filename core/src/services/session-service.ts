import { Session } from "../entities/session";
import { config } from "../config";
import { ISessionRepository } from "../repositories/session";
import { isExpired } from "../utils/session";
import { nowISO } from "../utils/date";
import { SessionKey, SessionStartReason } from "../types/session";

interface ISessionService {
  getSession(): Session;
  ensureActiveSession(): Session;
  updateCount(): void;
  updateMetadata(patch: Record<string, unknown>): void;
  forceRotate(reason: SessionStartReason, newMetadata?: Record<string, unknown>): Session;
}

class SessionService implements ISessionService {
  private sessionRepository: ISessionRepository;
  private session: Session;
  private readonly key: SessionKey;
  private readonly persistOnConstruct: boolean;
  private readonly rotateOnExpire: boolean;

  constructor(
    sessionRepository: ISessionRepository,
    session: Session,
    options: { persistOnConstruct?: boolean; rotateOnExpire?: boolean } = {},
  ) {
    this.sessionRepository = sessionRepository;
    this.key = { channel: session.channel, peerId: session.peerId, kind: session.kind };
    this.persistOnConstruct = options.persistOnConstruct ?? true;
    // Delegated (errand) sessions must not be silently rotated away by idle
    // TTL — a conversation that goes quiet overnight would otherwise lose
    // its thread. Explicit options.rotateOnExpire always wins.
    this.rotateOnExpire = options.rotateOnExpire ?? session.kind !== 'delegated';

    if (this.persistOnConstruct) {
      this.sessionRepository.save(session);
    }

    this.session = session;
  }

  getSession(): Session {
    return this.session;
  }

  ensureActiveSession(): Session {
    if (!this.rotateOnExpire) {
      return this.session;
    }

    if (!isExpired(this.session, config.SESSION.TTL_MS)) {
      return this.session;
    }

    this.session = this.rotate('idle');
    return this.session;
  }

  updateCount(): void {
    const messageCount = this.session.messageCount + 1;
    const metadata = { ...this.session.metadata, lastActivityAt: nowISO() };
    this.sessionRepository.update(this.session.id, { messageCount, metadata });
    this.session = new Session({ ...this.session, messageCount, metadata });
  }

  updateMetadata(patch: Record<string, unknown>): void {
    const metadata = { ...this.session.metadata, ...patch };
    this.sessionRepository.update(this.session.id, { metadata });
    this.session = new Session({ ...this.session, metadata });
  }

  forceRotate(reason: SessionStartReason, newMetadata?: Record<string, unknown>): Session {
    this.session = this.rotate(reason, newMetadata);
    return this.session;
  }

  private rotate(reason: SessionStartReason, metadata?: Record<string, unknown>): Session {
    const endedAt = nowISO();
    const newSession = new Session({ ...this.key, metadata: { ...metadata, startReason: reason } });
    this.sessionRepository.rotate(this.session.id, endedAt, newSession);
    return newSession;
  }
}

export { ISessionService, SessionService };
