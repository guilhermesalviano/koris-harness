import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestScope } from '../../../../src/services/providers/request-scope';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createRequestScope', () => {
  it('propagates caller cancellation and removes listeners and timers', () => {
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const scope = createRequestScope({ signal: caller.signal, hardTimeoutMs: 100, idleTimeoutMs: 20 });
    scope.bumpIdle();
    caller.abort('cancelled');
    expect(scope.controller.signal.reason).toBe('cancelled');
    scope.cleanup();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    scope.bumpIdle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves pre-existing cancellation without scheduling a timer', () => {
    const caller = new AbortController();
    caller.abort('already cancelled');
    const scope = createRequestScope({ signal: caller.signal, hardTimeoutMs: 100 });
    expect(scope.controller.signal.reason).toBe('already cancelled');
    expect(vi.getTimerCount()).toBe(0);
    scope.cleanup();
  });

  it('resets the idle deadline without extending the hard deadline', () => {
    const scope = createRequestScope({ hardTimeoutMs: 100, idleTimeoutMs: 70 });
    scope.bumpIdle();
    vi.advanceTimersByTime(60);
    scope.bumpIdle();
    vi.advanceTimersByTime(39);
    expect(scope.controller.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(scope.controller.signal.aborted).toBe(true);
    scope.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts an idle stream before the hard deadline', () => {
    const scope = createRequestScope({ hardTimeoutMs: 100, idleTimeoutMs: 20 });
    scope.bumpIdle();
    vi.advanceTimersByTime(20);
    expect(scope.controller.signal.aborted).toBe(true);
    scope.cleanup();
  });
});
