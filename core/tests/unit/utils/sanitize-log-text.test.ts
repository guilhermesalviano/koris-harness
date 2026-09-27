import { describe, expect, it } from 'vitest';
import { sanitizeLogText, sanitizeMeta } from '../../../src/utils/sanitize-log-text';

describe('sanitizeLogText', () => {
  it('escapes CR and LF to visible sequences', () => {
    expect(sanitizeLogText('line1\r\nline2\nline3\rline4')).toBe('line1\\r\\nline2\\nline3\\rline4');
  });

  it('removes forbidden control characters', () => {
    const input = `a${String.fromCharCode(0)}b${String.fromCharCode(7)}c${String.fromCharCode(31)}d${String.fromCharCode(127)}e`;
    expect(sanitizeLogText(input)).toBe('abcde');
  });

  it('keeps regular printable content unchanged', () => {
    expect(sanitizeLogText('plain text 123 !?')).toBe('plain text 123 !?');
  });
});

describe('sanitizeMeta', () => {
  it('returns undefined when meta is not provided', () => {
    expect(sanitizeMeta(undefined)).toBeUndefined();
  });

  it('returns undefined when meta is null', () => {
    expect(sanitizeMeta(null)).toBeUndefined();
  });

  it('keeps nested null values as null', () => {
    expect(sanitizeMeta({ a: null, b: undefined, c: 0, d: false })).toEqual({
      a: null,
      b: undefined,
      c: 0,
      d: false,
    });
  });

  it('leaves JSON strings untouched', () => {
    const json = '{"command":"echo hi\\nworld"}';
    expect(sanitizeMeta({ value: json })).toEqual({ value: json });
  });

  it('leaves nested JSON strings untouched', () => {
    const json = '[{"a":"x\\ny"}]';
    expect(sanitizeMeta({ outer: { value: json } })).toEqual({ outer: { value: json } });
  });

  it('still sanitizes strings that are not valid JSON', () => {
    expect(sanitizeMeta({ value: 'hello\nworld' })).toEqual({ value: 'hello\\nworld' });
    expect(sanitizeMeta({ value: '{"broken": ' })).toEqual({ value: '{"broken": ' });
  });

  it('preserves embedded JSON while sanitizing surrounding text', () => {
    const input = 'request failed\npayload: {"a":1,\n"b":2}\ndone';
    expect(sanitizeMeta({ value: input })).toEqual({
      value: 'request failed\\npayload: {"a":1,\n"b":2}\\ndone',
    });
  });

  it('preserves multiple embedded JSON regions', () => {
    const input = 'first {"x":1\n} second ["a\\nb"] end';
    expect(sanitizeMeta({ value: input })).toEqual({
      value: 'first {"x":1\n} second ["a\\nb"] end',
    });
  });

  it('does not treat braces inside JSON strings as nesting', () => {
    const input = 'log\n{"msg":"has {brace} and \\"quote\\""} tail';
    expect(sanitizeMeta({ value: input })).toEqual({
      value: 'log\\n{"msg":"has {brace} and \\"quote\\""} tail',
    });
  });

  it('treats a JSON region followed by sanitizable text', () => {
    const input = '{"ok":true}\nand\nmore';
    expect(sanitizeMeta({ value: input })).toEqual({
      value: '{"ok":true}\\nand\\nmore',
    });
  });

  it('sanitizes string fields recursively', () => {
    const meta = {
      message: 'hello\nworld',
      nested: { note: 'a\rb' },
      list: ['x\ny', 1, true],
    };

    expect(sanitizeMeta(meta)).toEqual({
      message: 'hello\\nworld',
      nested: { note: 'a\\rb' },
      list: ['x\\ny', 1, true],
    });
  });

  it('sanitizes Error objects', () => {
    const err = new Error('bad\nnews');
    err.name = 'Oops\rError';

    const out = sanitizeMeta({ err }) as { err: { name: string; message: string; stack?: string } };

    expect(out.err.name).toBe('Oops\\rError');
    expect(out.err.message).toBe('bad\\nnews');
    expect(typeof out.err.stack === 'string' || out.err.stack === undefined).toBe(true);
  });

  it('replaces circular references with [Circular]', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;

    expect(sanitizeMeta({ node })).toEqual({
      node: {
        name: 'root',
        self: '[Circular]',
      },
    });
  });

  it('stringifies unsupported primitive-like values safely', () => {
    const out = sanitizeMeta({ value: Symbol('x') }) as { value: string };
    expect(out.value).toContain('Symbol(x)');
  });

  it('stringifies function values safely', () => {
    const out = sanitizeMeta({ value: () => 'fn' }) as { value: string };
    expect(out.value).toBe('() => "fn"');
  });

  it('stringifies bigint values safely', () => {
    const out = sanitizeMeta({ value: 123n }) as { value: string };
    expect(out.value).toBe('123');
  });
});
