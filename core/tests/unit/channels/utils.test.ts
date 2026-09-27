import { describe, expect, it } from 'vitest';
import { resolveResponse, splitForCapabilities, splitMessage } from '../../../src/channels/utils';
import { RESPONSE_ANCHOR, THINK_END, THINK_START } from '../../../src/constants/thinking';

async function* createResponseStream(): AsyncGenerator<string> {
  yield THINK_START;
  yield 'internal reasoning';
  yield THINK_END;
  yield RESPONSE_ANCHOR;
  yield 'Visible reply';
}

describe('channels/utils splitMessage', () => {
  it('returns an empty array for empty text', () => {
    expect(splitMessage('', 100)).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    expect(splitMessage('short message', 100)).toEqual(['short message']);
  });

  it('splits long text on whitespace boundaries', () => {
    const chunks = splitMessage('a'.repeat(100) + ' ' + 'b'.repeat(100), 50);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('').replace(/\s/g, '')).toBe('a'.repeat(100) + 'b'.repeat(100));
    expect(chunks.every((chunk) => chunk.length <= 51)).toBe(true);
  });
});

describe('channels/utils resolveResponse', () => {
  it('strips internal markers from a plain string', async () => {
    const text = `${THINK_START}hidden${THINK_END}${RESPONSE_ANCHOR}Visible`;

    expect(await resolveResponse(text)).toBe('Visible');
  });

  it('concatenates and strips an async iterable response', async () => {
    expect(await resolveResponse(createResponseStream())).toBe('Visible reply');
  });

  it('coerces other values with String()', async () => {
    expect(await resolveResponse(42)).toBe('42');
    expect(await resolveResponse({})).toBe('[object Object]');
  });
});

describe('channels/utils splitForCapabilities', () => {
  it('chunks using the capability-declared maxMessageChars, not a hardcoded limit', () => {
    const chunks = splitForCapabilities('a'.repeat(100), { maxMessageChars: 40 });

    expect(chunks.every((chunk) => chunk.length <= 40)).toBe(true);
    expect(chunks.join('')).toBe('a'.repeat(100));
  });

  it('returns a single chunk when the text fits within the limit', () => {
    expect(splitForCapabilities('short', { maxMessageChars: 4_000 })).toEqual(['short']);
  });
});