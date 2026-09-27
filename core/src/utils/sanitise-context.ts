/**
 * Sanitises a user-supplied string before it is embedded verbatim into the
 * LLM context block inside `buildPrompt` (ChannelHandler). Prevents simple
 * prompt-injection attacks via crafted group names, sender names, or quoted
 * text that contain angle-bracket markup or control characters.
 */
export function sanitiseContextField(value: string): string {
  return value
    // Strip < and > to prevent XML/HTML-tag injection into the system prompt.
    .replace(/[<>]/g, '')
    // Replace ASCII control characters (NUL–US, DEL) with a space.
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    // Collapse repeated whitespace produced by the replacements above.
    .replace(/  +/g, ' ')
    .trim()
    // Cap at 256 characters — group/sender names have no legitimate reason
    // to be longer, and this limits the injection surface area.
    .slice(0, 256);
}
