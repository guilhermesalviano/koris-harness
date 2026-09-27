import { describe, it, expect } from 'vitest';
import { formatISO, formatDateTime, getTimezone, nowISO } from '../../../src/utils/date';

const INSTANT = new Date('2024-06-01T12:00:00.000Z');

describe('date utils', () => {
  it('getTimezone returns the configured timezone', () => {
    expect(getTimezone()).toBe('America/Sao_Paulo');
  });

  it('formatISO renders wall-clock time and offset for the given zone', () => {
    expect(formatISO(INSTANT, 'America/Sao_Paulo')).toBe('2024-06-01T09:00:00.000-03:00');
    expect(formatISO(INSTANT, 'Asia/Tokyo')).toBe('2024-06-01T21:00:00.000+09:00');
  });

  it('formatISO uses Z for UTC', () => {
    expect(formatISO(INSTANT, 'UTC')).toBe('2024-06-01T12:00:00.000Z');
  });

  it('formatISO round-trips through Date.parse', () => {
    expect(new Date(formatISO(INSTANT, 'America/Sao_Paulo')).getTime()).toBe(INSTANT.getTime());
  });

  it('nowISO returns the current instant in the configured timezone', () => {
    const now = nowISO();
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(Math.abs(new Date(now).getTime() - Date.now())).toBeLessThan(5000);
  });

  it('formatDateTime renders a human-readable date', () => {
    const formatted = formatDateTime(INSTANT, 'America/Sao_Paulo');
    expect(formatted).toContain('2024');
    expect(formatted).toContain('GMT-3');
  });
});
