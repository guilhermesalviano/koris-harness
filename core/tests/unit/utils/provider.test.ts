import { describe, expect, it } from 'vitest';
import { validateBaseUrl } from '../../../src/utils/provider';

describe('validateBaseUrl', () => {
  it('throws for invalid URL', () => {
    expect(() => validateBaseUrl('not-a-url')).toThrow('Invalid AI base URL: not-a-url');
  });

  it('throws for unsupported protocol', () => {
    expect(() => validateBaseUrl('ftp://localhost:11434')).toThrow('Unsupported AI base URL protocol: ftp:');
  });

  it('throws when URL includes credentials', () => {
    expect(() => validateBaseUrl('http://user:pass@localhost:11434')).toThrow(
      'AI base URL must not include credentials',
    );
  });

  it('throws when the URL includes only a username', () => {
    expect(() => validateBaseUrl('http://user@localhost:11434')).toThrow(
      'AI base URL must not include credentials',
    );
  });

  it('throws when the URL includes only a password', () => {
    expect(() => validateBaseUrl('http://:pass@localhost:11434')).toThrow(
      'AI base URL must not include credentials',
    );
  });

  it('allows localhost', () => {
    expect(validateBaseUrl('http://localhost:11434')).toBe('http://localhost:11434');
  });

  it('allows IPv4 loopback', () => {
    expect(validateBaseUrl('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
  });

  it('allows IPv6 loopback', () => {
    expect(validateBaseUrl('http://[::1]:11434')).toBe('http://[::1]:11434');
  });

  it('allows remote hosts', () => {
    expect(validateBaseUrl('https://api.example.com/v1/chat')).toBe('https://api.example.com');
  });

  it('returns origin only (drops path/query/hash)', () => {
    expect(validateBaseUrl('https://example.com/path?q=1#x')).toBe('https://example.com');
  });
});
