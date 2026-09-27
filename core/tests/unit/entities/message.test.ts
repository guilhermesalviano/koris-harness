import { describe, it, expect } from 'vitest';
import { Message } from '../../../src/entities/message';

describe('Message entity', () => {
  const baseProps = { sessionId: 'sess-1', role: 'user' as const, content: 'Hello' };

  it('assigns provided id', () => {
    const msg = new Message({ ...baseProps, id: 'fixed-id' });
    expect(msg.id).toBe('fixed-id');
  });

  it('generates uuid when id is omitted', () => {
    const msg = new Message(baseProps);
    expect(msg.id).toMatch(/^[0-9a-f]{13}$/);
  });

  it('stores sessionId', () => {
    const msg = new Message(baseProps);
    expect(msg.sessionId).toBe('sess-1');
  });

  it('stores role', () => {
    const msg = new Message(baseProps);
    expect(msg.role).toBe('user');
  });

  it('stores content', () => {
    const msg = new Message(baseProps);
    expect(msg.content).toBe('Hello');
  });

  it('assigns provided createdAt', () => {
    const ts = '2024-01-01T00:00:00.000Z';
    const msg = new Message({ ...baseProps, createdAt: ts });
    expect(msg.createdAt).toBe(ts);
  });

  it('generates ISO createdAt when omitted', () => {
    const msg = new Message(baseProps);
    expect(() => new Date(msg.createdAt)).not.toThrow();
    expect(msg.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('supports assistant role', () => {
    const msg = new Message({ ...baseProps, role: 'assistant' });
    expect(msg.role).toBe('assistant');
  });

  it('supports system role', () => {
    const msg = new Message({ ...baseProps, role: 'system' });
    expect(msg.role).toBe('system');
  });

  it('two messages with same content get distinct ids', () => {
    const a = new Message(baseProps);
    const b = new Message(baseProps);
    expect(a.id).not.toBe(b.id);
  });
});
