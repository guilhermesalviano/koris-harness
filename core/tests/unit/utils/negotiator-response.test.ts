import { describe, it, expect } from 'vitest';
import { parseNegotiatorResponse } from '../../../src/utils/negotiator-response';

describe('parseNegotiatorResponse', () => {
  it('parses a well-formed JSON verdict', () => {
    const verdict = parseNegotiatorResponse(JSON.stringify({
      action: 'continue',
      reply: 'Sure, what time works?',
      notes: 'they are interested',
    }));

    expect(verdict).toEqual({
      action: 'continue',
      reply: 'Sure, what time works?',
      notes: 'they are interested',
      detail: undefined,
    });
  });

  it('unwraps a fenced JSON code block', () => {
    const verdict = parseNegotiatorResponse('```json\n{"action":"resolved","reply":"Great, see you then!","detail":"scheduled for 3pm"}\n```');

    expect(verdict?.action).toBe('resolved');
    expect(verdict?.detail).toBe('scheduled for 3pm');
  });

  it.each([
    'Sure, I can do that for you.',
    '{"action":"bogus","reply":"hi"}',
    '{"action":"continue","reply":"Offer 80?","notes":"Private ceiling is 100"',
    '{"action":"continue","reply":42}',
    '{"action":"continue","notes":[]}',
    '{"action":"escalate","detail":null}',
    '[]', 'null', '{}',
  ])('rejects unsafe or invalid verdict %s', (response) => {
    expect(parseNegotiatorResponse(response)).toBeNull();
  });

  it('defaults reply to an empty string when absent from valid JSON', () => {
    const verdict = parseNegotiatorResponse(JSON.stringify({ action: 'escalate', detail: 'need your ok' }));
    expect(verdict?.reply).toBe('');
    expect(verdict?.detail).toBe('need your ok');
  });
});
