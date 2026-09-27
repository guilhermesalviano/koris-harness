import { config } from '../../config';
import { estimateTokens } from '../usage/usage';
import type { Message } from '../../entities/message';

// Rough fixed allowance for everything the prompt carries beyond the raw
// message history: system prompt, tool-execution contract, tool schemas,
// learned skills and the retrieved memory block (char-capped at ~15k upstream,
// i.e. ~3.75k tokens). Deliberately generous — under-counting here just defers
// to the reactive `context_length` retry.
const PROMPT_OVERHEAD_TOKENS = 4000;

/**
 * Rough token estimate for what the manager will send next turn: the resumed
 * compact summary (if any), every message in the loaded history (including
 * inline base64 image bytes), plus a fixed prompt overhead.
 */
export function estimateSessionTokens(history: Message[], compactSummary?: string): number {
  let chars = compactSummary ? compactSummary.length : 0;
  for (const message of history) {
    chars += message.content?.length ?? 0;
    for (const image of message.images ?? []) {
      chars += image.data?.length ?? 0;
    }
  }
  return estimateTokens(chars) + PROMPT_OVERHEAD_TOKENS;
}

/** Token count at or above which a manual-mode session should auto-compact. */
export function compactTriggerTokens(): number {
  return Math.floor(config.AI.MANAGER.NUM_CTX * config.SESSION.COMPACT_THRESHOLD);
}

/**
 * True when the current session is close enough to the manager's context
 * window that it should be compacted before the next turn. Only fires in
 * manual summarizer mode — 'auto' already condenses every exchange.
 */
export function shouldAutoCompact(history: Message[], compactSummary?: string): boolean {
  if (config.SESSION.SUMMARIZER_MODE !== 'manual') return false;
  if (history.length === 0) return false;
  return estimateSessionTokens(history, compactSummary) >= compactTriggerTokens();
}
