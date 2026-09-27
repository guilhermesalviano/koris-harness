import { describe, it, expect } from 'vitest';
import { Session } from '../../../src/entities/session';

describe('Session entity', () => {
  it('assigns provided id', () => {
    const session = new Session({ id: 'my-id', channel: 'web', peerId: 'web' });
    expect(session.id).toBe('my-id');
  });

  it('generates uuid when id is omitted', () => {
    const session = new Session({ channel: 'web', peerId: 'web' });
    expect(session.id).toMatch(/^[0-9a-f]{13}$/);
  });

  it('stores channel and peerId', () => {
    const session = new Session({ channel: 'whatsapp', peerId: '12345' });
    expect(session.channel).toBe('whatsapp');
    expect(session.peerId).toBe('12345');
  });

  it('defaults kind to user', () => {
    const session = new Session({ channel: 'whatsapp', peerId: '12345' });
    expect(session.kind).toBe('user');
  });

  it('defaults messageCount to 0', () => {
    const session = new Session({ channel: 'web', peerId: 'web' });
    expect(session.messageCount).toBe(0);
  });

  it('stores provided messageCount, including 0 explicitly', () => {
    const session = new Session({ channel: 'web', peerId: 'web', messageCount: 5 });
    expect(session.messageCount).toBe(5);

    const zero = new Session({ channel: 'web', peerId: 'web', messageCount: 0 });
    expect(zero.messageCount).toBe(0);
  });

  it('defaults metadata to empty object', () => {
    const session = new Session({ channel: 'web', peerId: 'web' });
    expect(session.metadata).toEqual({});
  });

  it('stores provided metadata', () => {
    const session = new Session({ channel: 'web', peerId: 'web', metadata: { userId: '42' } });
    expect(session.metadata).toEqual({ userId: '42' });
  });

  it('generates ISO startedAt when omitted', () => {
    const session = new Session({ channel: 'web', peerId: 'web' });
    expect(session.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('stores provided startedAt', () => {
    const ts = '2024-06-01T10:00:00.000Z';
    const session = new Session({ channel: 'web', peerId: 'web', startedAt: ts });
    expect(session.startedAt).toBe(ts);
  });

  it('stores endedAt when provided', () => {
    const ts = '2024-06-01T11:00:00.000Z';
    const session = new Session({ channel: 'web', peerId: 'web', endedAt: ts });
    expect(session.endedAt).toBe(ts);
  });

  it('endedAt is undefined when not provided', () => {
    const session = new Session({ channel: 'web', peerId: 'web' });
    expect(session.endedAt).toBeUndefined();
  });

  it('two sessions get distinct ids', () => {
    const a = new Session({ channel: 'web', peerId: 'web' });
    const b = new Session({ channel: 'web', peerId: 'web' });
    expect(a.id).not.toBe(b.id);
  });
});
