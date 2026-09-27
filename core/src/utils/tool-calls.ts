import { ToolCall } from '../types/tools';
import { ILogger } from '../infrastructure/logger';

function normalizeResponse(response: unknown): string {
  return typeof response === 'string' ? response : JSON.stringify(response);
}

/**
 * Extracts a JSON string from raw provider output.
 * Handles: pure JSON, markdown code blocks (```json...```) and JSON embedded in surrounding text.
 */
function extractJson(text: string): string | null {
  const trimmed = text.trim();

  // 1. Markdown code block: ```json ... ``` or ``` ... ```
  const markdownMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (markdownMatch) return markdownMatch[1].trim();

  // 2. Pure JSON starting at beginning
  if (trimmed.startsWith('{')) return trimmed;

  // 3. JSON embedded somewhere in the text — find first { and match braces
  const start = trimmed.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === '{') depth++;
    else if (trimmed[i] === '}') {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Returns true if the accumulated streaming content looks like it could
 * contain a tool call (pure JSON object or markdown-wrapped JSON).
 */
function looksLikeToolCallJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('```');
}

/**
 * Extract and parse tool calls from AI provider response.
 * Handles both string and object argument formats from different providers,
 * as well as markdown-wrapped or text-embedded JSON.
 */
function extractToolCalls(response: string, logger?: ILogger): ToolCall[] {
  const json = extractJson(response);

  if (!json) {
    if (response.trim()) {
      logger?.debug('No JSON found in provider response, treating as plain text');
    }
    return [];
  }

  try {
    const parsed = JSON.parse(json);

    if (!parsed.tool_calls || !Array.isArray(parsed.tool_calls)) {
      return [];
    }

    return parsed.tool_calls
      .map((tc: any, index: number) => {
        try {
          return parseToolCall(tc, index, logger);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger?.warn('Failed to parse tool call', {
            index,
            error: errorMsg,
            toolCall: tc,
          });
          return null;
        }
      })
      .filter((tc: any): tc is ToolCall => tc !== null);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger?.warn('Failed to parse response as JSON', { error: errorMsg });
    return [];
  }
}

/**
 * Parse individual tool call, handling both string and object arguments
 */
function parseToolCall(tc: any, index: number, logger?: ILogger): ToolCall {
  const name = tc.function?.name || 'unknown';
  const rawArgs = tc.function?.arguments;

  let parsedArgs: Record<string, unknown>;

  if (typeof rawArgs === 'string') {
    try {
      parsedArgs = JSON.parse(rawArgs);
      logger?.debug('Parsed string arguments', { toolName: name, index });
    } catch (err) {
      logger?.warn('Failed to parse arguments string, using as-is', {
        toolName: name,
        index,
        arguments: rawArgs,
      });
      parsedArgs = { raw: rawArgs };
    }
  } else if (typeof rawArgs === 'object' && rawArgs !== null) {
    parsedArgs = rawArgs as Record<string, unknown>;
  } else {
    logger?.warn('Unexpected arguments type', {
      toolName: name,
      index,
      type: typeof rawArgs,
    });
    parsedArgs = {};
  }

  const extraContent = tc.extra_content;

  return {
    id: typeof tc.id === 'string' && tc.id ? tc.id : `call_${index}`,
    name,
    arguments: parsedArgs,
    // Gemini rejects the follow-up turn unless its thought_signature is echoed back.
    ...(extraContent && typeof extraContent === 'object' && !Array.isArray(extraContent) ? { extraContent } : {}),
  };
}

export { extractToolCalls, extractJson, looksLikeToolCallJson, normalizeResponse };
