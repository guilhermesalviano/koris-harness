import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { config } from '../../../../src/config';
import {
  estimateSessionTokens,
  compactTriggerTokens,
  shouldAutoCompact,
} from '../../../../src/services/agents/context-budget';
import { applyTestConfigDefaults } from '../../../helpers/test-config';
import type { Message } from '../../../../src/entities/message';

function msg(content: string): Message {
  return { role: 'user', content } as Message;
}

function setManagerNumCtx(value: number): void {
  Object.defineProperty(config.AI.MANAGER, 'NUM_CTX', { value, configurable: true, writable: true });
}

function setCompactThreshold(value: number): void {
  Object.defineProperty(config.SESSION, 'COMPACT_THRESHOLD', { value, configurable: true, writable: true });
}

describe('context-budget', () => {
  let originalNumCtx: number;
  let originalThreshold: number;

  beforeEach(() => {
    originalNumCtx = config.AI.MANAGER.NUM_CTX;
    originalThreshold = config.SESSION.COMPACT_THRESHOLD;
  });

  afterEach(() => {
    setManagerNumCtx(originalNumCtx);
    setCompactThreshold(originalThreshold);
    applyTestConfigDefaults();
  });

  it('estimates tokens from history chars, image bytes and the compact summary plus overhead', () => {
    const base = estimateSessionTokens([]);
    expect(base).toBeGreaterThan(0);

    const withHistory = estimateSessionTokens([msg('a'.repeat(4000))]);
    expect(withHistory).toBe(base + 1000);

    const withImage = estimateSessionTokens([
      { role: 'user', content: '', images: [{ data: 'b'.repeat(4000) }] } as Message,
    ]);
    expect(withImage).toBe(base + 1000);

    const withSummary = estimateSessionTokens([], 'c'.repeat(4000));
    expect(withSummary).toBe(base + 1000);
  });

  it('derives the trigger token count from num_ctx * threshold', () => {
    setManagerNumCtx(20000);
    setCompactThreshold(0.9);
    expect(compactTriggerTokens()).toBe(18000);
  });

  it('only fires shouldAutoCompact in manual mode, over the threshold, with history', () => {
    setManagerNumCtx(20000);
    setCompactThreshold(0.9); // trigger at 18000 tokens

    const big = [msg('x'.repeat(80000))]; // ~20000 tokens + overhead
    const small = [msg('x'.repeat(400))];

    applyTestConfigDefaults({ summarizerMode: 'manual' });
    expect(shouldAutoCompact(big)).toBe(true);
    expect(shouldAutoCompact(small)).toBe(false);
    expect(shouldAutoCompact([])).toBe(false);

    applyTestConfigDefaults({ summarizerMode: 'auto' });
    expect(shouldAutoCompact(big)).toBe(false);
  });
});
