import { describe, it, expect, vi } from 'vitest';
import { OutboundMessageRepository } from '../../../src/repositories/outbound-message';
import { OutboundMessage } from '../../../src/entities/outbound-message';

function makeDb() {
  return { run: vi.fn(), query: vi.fn().mockReturnValue([]), get: vi.fn() };
}

function makeMessage() {
  return new OutboundMessage({
    id: 'm1',
    channel: 'telegram',
    target: '987654321',
    content: 'Olá!',
    status: 'sent',
    createdAt: '2026-01-01T00:00:00.000Z',
    sentAt: '2026-01-01T00:00:01.000Z',
  });
}

describe('OutboundMessageRepository', () => {
  it('save inserts the outbound message', () => {
    const db = makeDb();
    const repository = new OutboundMessageRepository(db as never);
    const message = makeMessage();

    repository.save(message);

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain('INSERT INTO outbound_messages');
    expect(params[0]).toBe('m1');
    expect(params[1]).toBe('telegram');
    expect(params[2]).toBe('987654321');
    expect(params[3]).toBe('Olá!');
    expect(params[4]).toBe('sent');
  });

  it('save stores null error when absent', () => {
    const db = makeDb();
    const repository = new OutboundMessageRepository(db as never);
    const message = new OutboundMessage({
      id: 'm2',
      channel: 'whatsapp',
      target: '5511@s.whatsapp.net',
      content: 'Oi',
      status: 'failed',
      errorMessage: 'boom',
    });

    repository.save(message);

    const params = db.run.mock.calls[0][1];
    expect(params[5]).toBe('boom');
    expect(params[7]).toBeNull();
  });

  it('getById returns null when no row is found', () => {
    const db = makeDb();
    db.get.mockReturnValue(undefined);
    const repository = new OutboundMessageRepository(db as never);

    expect(repository.getById('nope')).toBeNull();
    expect(db.get).toHaveBeenCalledWith('SELECT * FROM outbound_messages WHERE id = ?', ['nope']);
  });

  it('getAll queries the exact SQL with the limit', () => {
    const db = makeDb();
    const repository = new OutboundMessageRepository(db as never);

    repository.getAll(50);

    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM outbound_messages ORDER BY created_at DESC LIMIT ?',
      [50],
    );
  });

  it('getAll maps rows into OutboundMessage entities', () => {
    const db = makeDb();
    db.query.mockReturnValue([
      {
        id: 'm1',
        channel: 'telegram',
        target: '987654321',
        content: 'Olá!',
        status: 'sent',
        error_message: null,
        created_at: '2026-01-01T00:00:00.000Z',
        sent_at: '2026-01-01T00:00:01.000Z',
      },
    ]);
    const repository = new OutboundMessageRepository(db as never);

    const items = repository.getAll();

    expect(items).toHaveLength(1);
    expect(items[0]).toBeInstanceOf(OutboundMessage);
    expect(items[0].target).toBe('987654321');
    expect(items[0].status).toBe('sent');
  });

  it('markSent updates the status, sent_at and clears the error', () => {
    const db = makeDb();
    const repository = new OutboundMessageRepository(db as never);

    repository.markSent('m1');

    const [sql, params] = db.run.mock.calls[0];
    expect(sql).toContain("status = 'sent'");
    expect(sql).toContain('sent_at = ?');
    expect(sql).toContain('error_message = NULL');
    expect(params[1]).toBe('m1');
  });

  it('markFailed updates the status and error message', () => {
    const db = makeDb();
    const repository = new OutboundMessageRepository(db as never);

    repository.markFailed('m1', 'network error');

    expect(db.run).toHaveBeenCalledWith(
      "UPDATE outbound_messages SET status = 'failed', error_message = ? WHERE id = ?",
      ['network error', 'm1'],
    );
  });

  it('count returns the total', () => {
    const db = makeDb();
    db.get.mockReturnValue({ total: 7 });
    const repository = new OutboundMessageRepository(db as never);

    expect(repository.count()).toBe(7);
  });
});