export function toSafeMessage(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input === null || input === undefined) return '';
  try {
    return String(input);
  } catch {
    return '';
  }
}

export function previewMessage(message: string, maxLen = 200): string {
  const trimmed = message.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}