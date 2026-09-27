import { IDatabaseService } from "../infrastructure/db-sqlite";
import { SessionRepositoryFactory, ISessionRepository } from "../repositories/session";
import { SessionService, ISessionService } from "./session-service";
import { config } from "../config";
import { isExpired } from "../utils/session";
import { Session } from "../entities/session";
import { SessionKey } from "../types/session";

// `byIdCache` mints a permanent entry per client-supplied session id (admin
// API, tool calls), so it's capped as a simple insertion-order LRU rather
// than left to grow unbounded for the life of the process.
const BY_ID_CACHE_MAX = 500;

function cacheKey(key: SessionKey): string {
  return `${key.channel} ${key.peerId} ${key.kind ?? 'user'}`;
}

export interface ISessionManager {
  getSessionService(key: SessionKey): ISessionService;
  getSessionServiceById(sessionId: string): ISessionService;
  invalidate(sessionId: string): void;
  invalidateKey(key: SessionKey): void;
}

export class SessionManager implements ISessionManager {
  private cache: Map<string, ISessionService> = new Map();
  private byIdCache: Map<string, ISessionService> = new Map();
  private sessionRepository: ISessionRepository;

  constructor(private db: IDatabaseService) {
    this.sessionRepository = SessionRepositoryFactory.create(this.db);
  }

  getSessionService(key: SessionKey): ISessionService {
    const composite = cacheKey(key);
    if (this.cache.has(composite)) {
      return this.cache.get(composite)!;
    }

    const existing = this.sessionRepository.findLatestOpen(key);

    let sessionService: ISessionService;

    if (existing && (existing.kind === 'delegated' || !isExpired(existing, config.SESSION.TTL_MS))) {
      sessionService = new SessionService(this.sessionRepository, existing, { persistOnConstruct: false });
    } else {
      const session = new Session({
        channel: key.channel,
        peerId: key.peerId,
        kind: key.kind,
        // Replacing an open session that went idle; a brand-new thread has no reason.
        metadata: existing ? { startReason: 'idle' } : undefined,
      });
      sessionService = new SessionService(this.sessionRepository, session);
    }

    this.cache.set(composite, sessionService);
    return sessionService;
  }

  getSessionServiceById(sessionId: string): ISessionService {
    if (this.byIdCache.has(sessionId)) {
      // Refresh recency for the LRU eviction order.
      const cached = this.byIdCache.get(sessionId)!;
      this.byIdCache.delete(sessionId);
      if (cached.getSession().id === sessionId) {
        this.byIdCache.set(sessionId, cached);
        return cached;
      }
    }

    const session = this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const sessionService = new SessionService(this.sessionRepository, session, {
      persistOnConstruct: false,
      rotateOnExpire: false,
    });

    if (this.byIdCache.size >= BY_ID_CACHE_MAX) {
      const oldestKey = this.byIdCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.byIdCache.delete(oldestKey);
      }
    }
    this.byIdCache.set(sessionId, sessionService);
    return sessionService;
  }

  invalidate(sessionId: string): void {
    this.byIdCache.delete(sessionId);
    for (const [id, service] of this.byIdCache.entries()) {
      if (service.getSession().id === sessionId) this.byIdCache.delete(id);
    }
    for (const [composite, service] of this.cache.entries()) {
      if (service.getSession().id === sessionId) {
        this.cache.delete(composite);
      }
    }
  }

  invalidateKey(key: SessionKey): void {
    this.cache.delete(cacheKey(key));
  }
}
