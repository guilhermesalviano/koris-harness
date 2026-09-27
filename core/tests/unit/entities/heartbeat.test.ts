import { describe, it, expect } from 'vitest';
import { Heartbeat } from '../../../src/entities/heartbeat';

describe('Heartbeat entity', () => {
  const base = { beat: 'send report', type: 'reminder' as const, cronExpression: '0 9 * * 1' };

  it('assigns provided id', () => {
    expect(new Heartbeat({ ...base, id: 'hb-1' }).id).toBe('hb-1');
  });

  it('generates id when omitted', () => {
    expect(new Heartbeat(base).id).toMatch(/^[0-9a-f]{13}$/);
  });

  it('stores beat', () => {
    expect(new Heartbeat(base).beat).toBe('send report');
  });

  it('stores type', () => {
    expect(new Heartbeat(base).type).toBe('reminder');
  });

  it('accepts scheduled_beat type', () => {
    expect(new Heartbeat({ ...base, type: 'scheduled_beat' }).type).toBe('scheduled_beat');
  });

  it('stores cronExpression', () => {
    expect(new Heartbeat(base).cronExpression).toBe('0 9 * * 1');
  });

  it('stores lastRun when provided', () => {
    const d = new Date();
    expect(new Heartbeat({ ...base, lastRun: d }).lastRun).toEqual(d);
  });

  it('lastRun is undefined when not provided', () => {
    expect(new Heartbeat(base).lastRun).toBeUndefined();
  });

  it('defaults createdAt to current time', () => {
    const before = new Date();
    expect(new Heartbeat(base).createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('stores provided createdAt', () => {
    const d = new Date('2024-06-01T00:00:00Z');
    expect(new Heartbeat({ ...base, createdAt: d }).createdAt).toEqual(d);
  });

  it('two heartbeats get distinct ids', () => {
    const a = new Heartbeat(base);
    const b = new Heartbeat(base);
    expect(a.id).not.toBe(b.id);
  });
});
