import { describe, it, expect, vi } from 'vitest';
import { OutboundMessageService } from '../../../../src/services/outbound/message-service';
import { OutboundMessage } from '../../../../src/entities/outbound-message';

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };

function makeChannels() {
  return { sendMessage: vi.fn().mockResolvedValue(undefined) };
}

function makeOutboundRepo(overrides: Record<string, unknown> = {}) {
  return {
    save: vi.fn(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
    getById: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    count: vi.fn().mockReturnValue(0),
    ...overrides,
  };
}

function makeDb() {
  return { run: vi.fn(), get: vi.fn(), query: vi.fn(() => []), transaction: vi.fn((fn: () => unknown) => fn()) };
}

function makeSessionManager() {
  const sessionService = {
    getSession: () => ({ id: 'target-session' }),
    ensureActiveSession: () => ({ id: 'target-session' }),
    updateCount: vi.fn(),
  };
  return {
    getSessionService: vi.fn().mockReturnValue(sessionService),
    getSessionServiceById: vi.fn(),
  };
}

function makeService(
  channels = makeChannels(),
  outboundRepo = makeOutboundRepo(),
  db = makeDb(),
  sessionManager = makeSessionManager(),
) {
  const service = new OutboundMessageService(logger as never, db as never, channels as never, outboundRepo as never, sessionManager as never);
  return { service, channels, outboundRepo, db, sessionManager };
}

describe('OutboundMessageService', () => {
  it('sends to an explicit channel and target and marks as sent', async () => {
    const { service, channels, outboundRepo } = makeService();

    const result = await service.send({ content: 'Olá!', channel: 'telegram', target: '987654321' });

    expect(channels.sendMessage).toHaveBeenCalledWith('telegram', '987654321', 'Olá!');
    expect(outboundRepo.save).toHaveBeenCalledTimes(1);
    expect(outboundRepo.markSent).toHaveBeenCalledTimes(1);
    expect(result).toBeInstanceOf(OutboundMessage);
    expect(result.status).toBe('sent');
    expect(result.target).toBe('987654321');
  });

  it('records what was sent into the target session transcript after successful delivery', async () => {
    const { service, sessionManager, db } = makeService();

    await service.send({ content: 'Olá!', channel: 'telegram', target: '987654321' });

    expect(sessionManager.getSessionService).toHaveBeenCalledWith({ channel: 'telegram', peerId: '987654321', kind: 'user' });
    // MessageService.save → MessageRepository.save issues an INSERT INTO messages.
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO messages'), expect.any(Array));
  });

  it('records into the delegated session when kind is passed through', async () => {
    const { service, sessionManager } = makeService();

    await service.send({ content: 'Hi there', channel: 'whatsapp', target: '5551234', kind: 'delegated' });

    expect(sessionManager.getSessionService).toHaveBeenCalledWith({ channel: 'whatsapp', peerId: '5551234', kind: 'delegated' });
  });

  it('still delivers the message even if recording the transcript fails', async () => {
    const channels = makeChannels();
    const sessionManager = makeSessionManager();
    sessionManager.getSessionService.mockImplementation(() => {
      throw new Error('session layer down');
    });
    const { service } = makeService(channels, makeOutboundRepo(), makeDb(), sessionManager);

    const result = await service.send({ content: 'Olá!', channel: 'telegram', target: '987654321' });

    expect(channels.sendMessage).toHaveBeenCalledWith('telegram', '987654321', 'Olá!');
    expect(result.status).toBe('sent');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('records a failed message when sending throws', async () => {
    const channels = makeChannels();
    channels.sendMessage.mockRejectedValueOnce(new Error('channel down'));
    const outboundRepo = makeOutboundRepo({
      getById: vi.fn().mockReturnValue(
        new OutboundMessage({
          id: 'm1',
          channel: 'telegram',
          target: '111',
          content: 'Olá',
          status: 'failed',
          errorMessage: 'channel down',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    });
    const { service, db, sessionManager } = makeService(channels, outboundRepo);

    const result = await service.send({ content: 'Olá', channel: 'telegram', target: '111' });

    expect(outboundRepo.markFailed).toHaveBeenCalledWith(expect.any(String), 'channel down');
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('channel down');
    expect(db.run).not.toHaveBeenCalled();
    expect(sessionManager.getSessionService).not.toHaveBeenCalled();
  });

  it('throws for an invalid channel', async () => {
    const { service, channels } = makeService();

    await expect(service.send({ content: 'Olá', channel: 'slack', target: '111' })).rejects.toThrow('Invalid channel');
    expect(channels.sendMessage).not.toHaveBeenCalled();
  });
});
