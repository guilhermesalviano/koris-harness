// Sentinel markers injected into AI streams to delimit thinking blocks.
// A NULL-byte prefix ensures no collision with normal text content.
export const THINK_START = '\x00\x01';
export const THINK_END   = '\x00\x02';

/**
 * Emitted by streamingDispatch before the tool-execution result so the TUI
 * can reset its rendering anchor to below any progress messages that were
 * printed during tool execution.
 */
export const RESPONSE_ANCHOR = '\x00\x03';
