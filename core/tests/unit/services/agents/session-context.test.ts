import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionContextResolver } from '../../../../src/services/agents/session-context';
import type { ILogger } from '../../../../src/infrastructure/logger';

function makeLogger(): ILogger {
  return { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
}

function makeResolver(overrides: {
  getSessionServiceById?: ReturnType<typeof vi.fn>;
  getSessionService?: ReturnType<typeof vi.fn>;
} = {}) {
  const logger = makeLogger();
  const sessionService = { getSession: vi.fn().mockReturnValue({ id: 'session-1' }) };
  const byIdService = { getSession: vi.fn().mockReturnValue({ id: 'session-by-id' }) };
  const sessionManager = {
    getSessionService: overrides.getSessionService ?? vi.fn().mockReturnValue(sessionService),
    getSessionServiceById: overrides.getSessionServiceById ?? vi.fn().mockReturnValue(byIdService),
  };

  const resolver = new SessionContextResolver(logger, {} as never, sessionManager as never);

  return { resolver, logger, sessionService, byIdService, sessionManager };
}

const ORIGIN = { channel: 'whatsapp', peerId: 'origin-1', kind: 'user' as const };

describe('SessionContextResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the initiated channel session when no session id is provided', () => {
    const { resolver, sessionManager, sessionService } = makeResolver();

    const context = resolver.resolve(ORIGIN);

    expect(sessionManager.getSessionService).toHaveBeenCalledWith(ORIGIN);
    expect(context.sessionService).toBe(sessionService);
    expect(context.messageService).toBeDefined();
    expect(context.memoryService).toBeDefined();
  });

  it('resolves a specific session by id when provided', () => {
    const { resolver, sessionManager, byIdService } = makeResolver();

    const context = resolver.resolve(ORIGIN, 'session-by-id');

    expect(sessionManager.getSessionServiceById).toHaveBeenCalledWith('session-by-id');
    expect(sessionManager.getSessionService).not.toHaveBeenCalled();
    expect(context.sessionService).toBe(byIdService);
  });

  it('falls back to the initiated channel session when the session id is unknown', () => {
    const { resolver, logger, sessionManager, sessionService } = makeResolver({
      getSessionServiceById: vi.fn(() => {
        throw new Error('Session not found: missing');
      }),
    });

    const context = resolver.resolve(ORIGIN, 'missing');

    expect(sessionManager.getSessionServiceById).toHaveBeenCalledWith('missing');
    expect(sessionManager.getSessionService).toHaveBeenCalledWith(ORIGIN);
    expect(context.sessionService).toBe(sessionService);
    expect(logger.warn).toHaveBeenCalledWith(
      'Session "missing" not found, falling back to initiated channel session',
      expect.objectContaining({ origin: ORIGIN }),
    );
  });
});
