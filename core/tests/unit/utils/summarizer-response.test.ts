import { describe, it, expect } from 'vitest';
import { parseSummarizerResponse } from '../../../src/utils/summarizer-response';

describe('parseSummarizerResponse', () => {
  it('parses valid JSON with type and content', () => {
    const result = parseSummarizerResponse(
      '{"type":"fact","content":"User prefers dark mode."}',
    );
    expect(result).toEqual({ type: 'fact', content: 'User prefers dark mode.' });
  });

  it('defaults type to summary when type is missing', () => {
    const result = parseSummarizerResponse('{"content":"General recap."}');
    expect(result).toEqual({ type: 'summary', content: 'General recap.' });
  });

  it('defaults type to summary when type is invalid', () => {
    const result = parseSummarizerResponse(
      '{"type":"observation","content":"Something happened."}',
    );
    expect(result).toEqual({ type: 'summary', content: 'Something happened.' });
  });

  it('parses JSON wrapped in markdown fences', () => {
    const result = parseSummarizerResponse(
      '```json\n{"type":"lesson","content":"Always validate input."}\n```',
    );
    expect(result).toEqual({ type: 'lesson', content: 'Always validate input.' });
  });

  it('falls back to summary when response is plain text', () => {
    const result = parseSummarizerResponse('User asked about weather.');
    expect(result).toEqual({ type: 'summary', content: 'User asked about weather.' });
  });

  it('falls back to summary when JSON has no content', () => {
    const result = parseSummarizerResponse('{"type":"reminder"}');
    expect(result).toEqual({ type: 'summary', content: '{"type":"reminder"}' });
  });

  it('accepts all valid memory types', () => {
    for (const type of ['summary', 'fact', 'lesson', 'reminder'] as const) {
      const result = parseSummarizerResponse(`{"type":"${type}","content":"stored"}`);
      expect(result.type).toBe(type);
    }
  });
});
