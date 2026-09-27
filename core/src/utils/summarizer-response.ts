import { MemoryType } from '../types/memory';

const MEMORY_TYPES = new Set<MemoryType>(['summary', 'fact', 'lesson', 'reminder']);

function isMemoryType(value: string): value is MemoryType {
  return MEMORY_TYPES.has(value as MemoryType);
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export function parseSummarizerResponse(text: string): { type: MemoryType; content: string } {
  const parsed = tryParseJson(text);

  if (parsed && typeof parsed === 'object' && parsed !== null) {
    const record = parsed as Record<string, unknown>;
    const content = typeof record.content === 'string' ? record.content.trim() : '';
    const type = typeof record.type === 'string' && isMemoryType(record.type)
      ? record.type
      : 'summary';

    if (content) {
      return { type, content };
    }
  }

  return { type: 'summary', content: text.trim() };
}
