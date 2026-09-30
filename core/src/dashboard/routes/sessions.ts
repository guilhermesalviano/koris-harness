import type { Request, Response, Router } from 'express';
import { config } from '../../config';
import type { ISessionRepository } from '../../repositories/session';
import type { IMessageRepository, TimelineCursor } from '../../repositories/message';
import type { IMemoryRepository } from '../../repositories/memory';
import type { ISessionManager } from '../../services/session-manager';
import type { activeRunsRegistry } from '../active-runs';
import { Session } from '../../entities/session';
import type { SessionKey } from '../../types/session';
import { carryForwardMetadata } from '../../utils/session';
import { estimateSessionTokens, compactTriggerTokens } from '../../services/agents/context-budget';
import { parsePagination, queryInteger } from '../pagination';
import { toMessageJson, toSessionJson, toMemoryJson, sessionStartReason, previewText } from '../serializers';

/** The principal's own web chat — every session on it forms the Orchestrator thread. */
const ORCHESTRATOR_THREAD: Required<SessionKey> = { channel: 'web', peerId: 'web', kind: 'user' };

const TIMELINE_DEFAULT_LIMIT = 50;

function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.rowid])).toString('base64url');
}

/** `undefined` for no cursor, `null` for one that is malformed. */
function decodeTimelineCursor(raw: unknown): TimelineCursor | undefined | null {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && Number.isInteger(parsed[1])
    ) {
      return { createdAt: parsed[0], rowid: parsed[1] };
    }
  } catch {
    // fall through
  }
  return null;
}

export interface SessionsRouteDependencies {
  sessionRepo: Pick<ISessionRepository, 'findLatestOpen' | 'save' | 'findAll' | 'count' | 'findById' | 'deleteById'>;
  messageRepo: Pick<IMessageRepository, 'getTimeline' | 'getBySessionId' | 'getPreviewBySessionId'>;
  memoryRepo: Pick<IMemoryRepository, 'getBySessionId'>;
  sessionManager: Pick<ISessionManager, 'getSessionServiceById' | 'invalidateKey' | 'invalidate'>;
  activeRuns: Pick<typeof activeRunsRegistry, 'list'>;
}

export function registerSessionsRoutes(router: Router, dependencies: SessionsRouteDependencies): void {
  const { sessionRepo, messageRepo, memoryRepo, sessionManager, activeRuns } = dependencies;

  router.get('/agents/orchestrator/timeline', (req: Request, res: Response) => {
    const before = decodeTimelineCursor(req.query.before);
    if (before === null) {
      res.status(400).json({ error: 'Invalid cursor' });
      return;
    }
    const limit = queryInteger(req.query.limit, TIMELINE_DEFAULT_LIMIT, 1, 200);

    const page = messageRepo.getTimeline({ key: ORCHESTRATOR_THREAD, before, limit });
    const active = sessionRepo.findLatestOpen(ORCHESTRATOR_THREAD);

    const sessionIds = new Set(page.messages.map((m) => m.sessionId));
    if (!before && active) sessionIds.add(active.id);
    const sessions = [...sessionIds]
      .map((id) => (id === active?.id ? active : sessionRepo.findById(id)))
      .filter((session): session is Session => session !== null)
      .map((session) => ({
        id: session.id,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        startReason: sessionStartReason(session),
        compactSummary: typeof session.metadata.compactSummary === 'string' ? session.metadata.compactSummary : null,
      }));

    res.json({
      messages: page.messages.map((m) => ({ ...toMessageJson(m), sessionId: m.sessionId })),
      sessions,
      activeSessionId: active?.id ?? null,
      nextCursor: page.nextCursor ? encodeTimelineCursor(page.nextCursor) : null,
    });
  });

  router.post('/agents/orchestrator/new-session', (_req: Request, res: Response) => {
    const open = sessionRepo.findLatestOpen(ORCHESTRATOR_THREAD);

    if (open && activeRuns.list().some((run) => run.sessionId === open.id)) {
      res.status(409).json({ error: 'A reply is still running in this session' });
      return;
    }

    if (open && messageRepo.getBySessionId(open.id, 1).length === 0) {
      res.json({ session: toSessionJson(open), rotated: false });
      return;
    }

    let session: Session;
    if (open) {
      session = sessionManager
        .getSessionServiceById(open.id)
        .forceRotate('clear', carryForwardMetadata(open.metadata));
    } else {
      session = new Session({ ...ORCHESTRATOR_THREAD });
      sessionRepo.save(session);
    }
    sessionManager.invalidateKey(ORCHESTRATOR_THREAD);

    res.status(201).json({ session: toSessionJson(session), rotated: Boolean(open) });
  });

  router.get('/sessions', (req: Request, res: Response) => {
    const { limit, offset } = parsePagination(req);
    const kind = req.query.kind === 'user' ? 'user' : undefined;
    const sessions = sessionRepo.findAll(limit, offset, kind);
    res.json({
      total: sessionRepo.count(kind),
      limit,
      offset,
      items: sessions.map((session) => ({
        ...toSessionJson(session),
        preview: previewText(messageRepo.getPreviewBySessionId(session.id)),
      })),
    });
  });

  router.post('/sessions', (_req: Request, res: Response) => {
    const session = new Session({ channel: 'web', peerId: 'web' });
    sessionRepo.save(session);
    sessionManager.invalidateKey({ channel: session.channel, peerId: session.peerId, kind: session.kind });
    res.status(201).json(toSessionJson(session));
  });

  router.get('/sessions/:id', (req: Request, res: Response) => {
    const session = sessionRepo.findById(String(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const messages = messageRepo.getBySessionId(session.id, 200);
    const memories = memoryRepo.getBySessionId(session.id);

    res.json({
      session: toSessionJson(session),
      messages: messages.map(toMessageJson),
      memories: memories.map(toMemoryJson),
    });
  });

  router.delete('/sessions/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!sessionRepo.findById(id)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    sessionRepo.deleteById(id);
    sessionManager.invalidate(id);
    res.json({ success: true });
  });

  router.get('/chat/context', (req: Request, res: Response) => {
    const requestedId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    const session = requestedId
      ? sessionRepo.findById(requestedId)
      : sessionRepo.findLatestOpen({ channel: 'web', peerId: 'web' });
    const limit = config.AI.MANAGER.NUM_CTX;
    if (!session) {
      res.json({ used: 0, limit, threshold: compactTriggerTokens() });
      return;
    }

    // No limit arg → the same recent-history window the manager actually
    // sends to the model (and that the auto-compact check measures).
    const history = messageRepo.getBySessionId(session.id);
    const compactSummary = typeof session.metadata?.compactSummary === 'string'
      ? session.metadata.compactSummary
      : undefined;
    res.json({
      used: estimateSessionTokens(history, compactSummary),
      limit,
      threshold: compactTriggerTokens(),
    });
  });
}
