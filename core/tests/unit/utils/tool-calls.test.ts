import { describe, it, expect, vi } from 'vitest';
import { extractToolCalls, extractJson, looksLikeToolCallJson, normalizeResponse } from '../../../src/utils/tool-calls';
import { Message } from '../../../src/entities/message';
import { ILogger } from '../../../src/infrastructure/logger';

const mockLogger: ILogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeMessage(role: 'system' | 'user' | 'assistant', content: string): Message {
  return new Message({ sessionId: 'sess-1', role, content });
}

describe('normalizeResponse', () => {
  it('returns string as-is', () => {
    expect(normalizeResponse('hello')).toBe('hello');
  });

  it('serializes objects to JSON', () => {
    expect(normalizeResponse({ a: 1 })).toBe('{"a":1}');
  });

  it('serializes arrays to JSON', () => {
    expect(normalizeResponse([1, 2])).toBe('[1,2]');
  });

  it('serializes numbers', () => {
    expect(normalizeResponse(42)).toBe('42');
  });

  it('serializes null', () => {
    expect(normalizeResponse(null)).toBe('null');
  });
});

describe('extractJson', () => {
  it('returns pure JSON as-is', () => {
    expect(extractJson('{"tool_calls":[]}')).toBe('{"tool_calls":[]}');
  });

  it('strips markdown json code block', () => {
    const input = '```json\n{"tool_calls":[]}\n```';
    expect(extractJson(input)).toBe('{"tool_calls":[]}');
  });

  it('strips plain markdown code block', () => {
    const input = '```\n{"tool_calls":[]}\n```';
    expect(extractJson(input)).toBe('{"tool_calls":[]}');
  });

  it('extracts JSON embedded in surrounding text', () => {
    const input = 'Sure, I will run this: {"tool_calls":[]} done.';
    expect(extractJson(input)).toBe('{"tool_calls":[]}');
  });

  it('extracts nested objects with balanced braces', () => {
    expect(extractJson('prefix {"a":{"b":[1,2]},"c":3} suffix')).toBe('{"a":{"b":[1,2]},"c":3}');
  });

  it('stops at the matching closing brace', () => {
    expect(extractJson('prefix {"a":1} {"b":2}')).toBe('{"a":1}');
  });

  it('returns null when braces are unbalanced', () => {
    expect(extractJson('prefix {"a": ')).toBeNull();
  });

  it('returns the whole string when pure JSON starts with { but is unclosed', () => {
    expect(extractJson('{x')).toBe('{x');
  });

  it('extracts JSON whose opening brace is not at the start', () => {
    expect(extractJson('x{"a":1}')).toBe('{"a":1}');
  });

  it('extracts unbalanced JSON inside a markdown block verbatim', () => {
    expect(extractJson('```json\n{"a":1\n```')).toBe('{"a":1');
  });

  it('keeps trailing text after the closing brace of pure JSON', () => {
    expect(extractJson('  {"a":1}  tail')).toBe('{"a":1}  tail');
  });

  it('keeps extra content inside a markdown block without the json marker', () => {
    expect(extractJson('```\n{"a":1}\nrest\n```')).toBe('{"a":1}\nrest');
  });

  it('keeps extra content after JSON that starts right after the json marker', () => {
    expect(extractJson('```json{"a":1}\nrest\n```')).toBe('{"a":1}\nrest');
  });

  it('returns null for plain text with no JSON', () => {
    expect(extractJson('just some text')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractJson('')).toBeNull();
  });
});

describe('looksLikeToolCallJson', () => {
  it('returns true for text starting with {', () => {
    expect(looksLikeToolCallJson('{"tool_calls":[]}')).toBe(true);
  });

  it('returns true for text starting with ```', () => {
    expect(looksLikeToolCallJson('```json\n{}\n```')).toBe(true);
  });

  it('returns true for ``` text that does not end with ```', () => {
    expect(looksLikeToolCallJson('```json\n{"tool_calls":[]}')).toBe(true);
  });

  it('returns true even with leading whitespace', () => {
    expect(looksLikeToolCallJson('  {"tool_calls":[]}')).toBe(true);
  });

  it('returns false for plain prose', () => {
    expect(looksLikeToolCallJson('The answer is 42')).toBe(false);
  });

  it('returns false for text starting with other punctuation', () => {
    expect(looksLikeToolCallJson('["tool_calls"]')).toBe(false);
    expect(looksLikeToolCallJson('...{"a":1}')).toBe(false);
  });
});

describe('extractToolCalls', () => {
  it('returns empty array for non-JSON string', () => {
    expect(extractToolCalls('plain text')).toEqual([]);
  });

  it('returns empty array when tool_calls is absent', () => {
    expect(extractToolCalls(JSON.stringify({ message: 'hi' }))).toEqual([]);
  });

  it('returns empty array when tool_calls is not an array', () => {
    expect(extractToolCalls(JSON.stringify({ tool_calls: 'bad' }))).toEqual([]);
  });

  it('does not log a warning when tool_calls is absent or not an array', () => {
    vi.mocked(mockLogger.warn).mockClear();
    expect(extractToolCalls(JSON.stringify({ tool_calls: 'bad' }), mockLogger)).toEqual([]);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('parses tool calls with object arguments', () => {
    const payload = {
      tool_calls: [
        { function: { name: 'my_tool', arguments: { key: 'value' } } },
      ],
    };
    const result = extractToolCalls(JSON.stringify(payload));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('my_tool');
    expect(result[0].arguments).toEqual({ key: 'value' });
  });

  it('parses tool calls with JSON-string arguments (Ollama format)', () => {
    const payload = {
      tool_calls: [
        { function: { name: 'cmd', arguments: '{"command":"echo hi"}' } },
      ],
    };
    const result = extractToolCalls(JSON.stringify(payload));
    expect(result[0].arguments).toEqual({ command: 'echo hi' });
  });

  it('wraps unparseable string arguments in raw field', () => {
    const payload = {
      tool_calls: [
        { function: { name: 'cmd', arguments: 'not json' } },
      ],
    };
    const result = extractToolCalls(JSON.stringify(payload), mockLogger);
    expect(result[0].arguments).toEqual({ raw: 'not json' });
  });

  it('wraps unparseable string arguments even without a logger', () => {
    const payload = {
      tool_calls: [
        { function: { name: 'cmd', arguments: 'not json' } },
      ],
    };
    const result = extractToolCalls(JSON.stringify(payload));
    expect(result[0].arguments).toEqual({ raw: 'not json' });
  });

  it('defaults name to "unknown" when function.name is absent', () => {
    const payload = {
      tool_calls: [{ function: { arguments: {} } }],
    };
    const result = extractToolCalls(JSON.stringify(payload));
    expect(result[0].name).toBe('unknown');
  });

  it('defaults arguments to {} when rawArgs is null', () => {
    const payload = {
      tool_calls: [{ function: { name: 'tool', arguments: null } }],
    };
    const result = extractToolCalls(JSON.stringify(payload), mockLogger);
    expect(result[0].arguments).toEqual({});
  });

  it('defaults arguments to {} when rawArgs is null even without a logger', () => {
    const payload = {
      tool_calls: [{ function: { name: 'tool', arguments: null } }],
    };
    const result = extractToolCalls(JSON.stringify(payload));
    expect(result[0].arguments).toEqual({});
  });

  it('keeps valid entries and skips null tool_call items', () => {
    const payload = {
      tool_calls: [
        { function: { name: 'good', arguments: { x: 1 } } },
        null,
      ],
    };
    const result = extractToolCalls(JSON.stringify(payload));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('good');
  });

  it('logs a warn when an individual tool call entry fails to parse', () => {
    vi.mocked(mockLogger.warn).mockClear();
    const payload = {
      tool_calls: [
        { function: { name: 'good', arguments: {} } },
        null,
      ],
    };
    const result = extractToolCalls(JSON.stringify(payload), mockLogger);
    expect(result).toHaveLength(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to parse tool call',
      expect.objectContaining({ index: 1 }),
    );
  });

  it('defaults name and arguments when the function object is missing', () => {
    const payload = {
      tool_calls: [{ function: null }],
    };
    const result = extractToolCalls(JSON.stringify(payload), mockLogger);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('unknown');
    expect(result[0].arguments).toEqual({});
  });

  it('returns multiple tool calls in order', () => {
    const payload = {
      tool_calls: [
        { function: { name: 'tool_a', arguments: { a: 1 } } },
        { function: { name: 'tool_b', arguments: { b: 2 } } },
      ],
    };
    const result = extractToolCalls(JSON.stringify(payload));
    expect(result).toHaveLength(2);
    expect(result.map(r => r.name)).toEqual(['tool_a', 'tool_b']);
  });

  it('extracts tool calls from markdown-wrapped JSON', () => {
    const payload = { tool_calls: [{ function: { name: 'tool_a', arguments: { a: 1 } } }] };
    const input = '```json\n' + JSON.stringify(payload) + '\n```';
    const result = extractToolCalls(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('tool_a');
  });

  it('extracts tool calls from JSON embedded in surrounding text', () => {
    const payload = { tool_calls: [{ function: { name: 'tool_b', arguments: {} } }] };
    const input = 'I will do this now: ' + JSON.stringify(payload) + ' let me know if you need more.';
    const result = extractToolCalls(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('tool_b');
  });

  it('logs debug when non-empty text contains no JSON', () => {
    extractToolCalls('plain text', mockLogger);
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'No JSON found in provider response, treating as plain text',
    );
  });

  it('does not log debug when the response is empty', () => {
    vi.mocked(mockLogger.debug).mockClear();
    extractToolCalls('', mockLogger);
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });

  it('does not log debug for whitespace-only responses', () => {
    vi.mocked(mockLogger.debug).mockClear();
    extractToolCalls('   ', mockLogger);
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });

  it('returns an empty array and never throws when JSON is invalid and no logger is given', () => {
    expect(extractToolCalls('{"tool_calls": }')).toEqual([]);
  });

  it('returns an empty array when the response is not valid JSON', () => {
    expect(extractToolCalls('{"tool_calls": }', mockLogger)).toEqual([]);
  });

  it('logs a warn with details when the response is not valid JSON', () => {
    extractToolCalls('{"tool_calls": }', mockLogger);
    expect(mockLogger.warn).toHaveBeenCalledWith('Failed to parse response as JSON', {
      error: expect.stringContaining('Unexpected token'),
    });
  });

  it('logs debug when string arguments parse successfully', () => {
    const payload = {
      tool_calls: [{ function: { name: 'cmd', arguments: '{"a":1}' } }],
    };
    extractToolCalls(JSON.stringify(payload), mockLogger);
    expect(mockLogger.debug).toHaveBeenCalledWith('Parsed string arguments', {
      toolName: 'cmd',
      index: 0,
    });
  });

  it('logs a warn with the raw arguments when the string cannot be parsed', () => {
    const payload = {
      tool_calls: [{ function: { name: 'cmd', arguments: 'not json' } }],
    };
    extractToolCalls(JSON.stringify(payload), mockLogger);
    expect(mockLogger.warn).toHaveBeenCalledWith('Failed to parse arguments string, using as-is', {
      toolName: 'cmd',
      index: 0,
      arguments: 'not json',
    });
  });

  it('logs a warn with the type when arguments are null', () => {
    const payload = {
      tool_calls: [{ function: { name: 'tool', arguments: null } }],
    };
    extractToolCalls(JSON.stringify(payload), mockLogger);
    expect(mockLogger.warn).toHaveBeenCalledWith('Unexpected arguments type', {
      toolName: 'tool',
      index: 0,
      type: 'object',
    });
  });
});

describe('extractToolCalls provider extra content', () => {
  it('keeps a tool call\'s extra_content (Gemini thought_signature) so it can be echoed back', () => {
    const extraContent = { google: { thought_signature: 'sig-abc' } };
    const calls = extractToolCalls(JSON.stringify({
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'start_errand', arguments: '{}' }, extra_content: extraContent }],
    }));
    expect(calls).toEqual([{ id: 'call_1', name: 'start_errand', arguments: {}, extraContent }]);
  });

  it('omits extraContent when the provider sends none', () => {
    const [call] = extractToolCalls(JSON.stringify({ tool_calls: [{ id: 'call_1', function: { name: 'x', arguments: {} } }] }));
    expect(call).not.toHaveProperty('extraContent');
  });
});
