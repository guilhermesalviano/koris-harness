import { afterEach, describe, expect, it, vi } from 'vitest';
import { SerialQueue } from '../../../../src/services/providers/serial-queue';

afterEach(() => vi.useRealTimers());

describe('SerialQueue', () => {
  it('clears a sleeping grace timer when interactive work wakes the queue', async () => {
    vi.useFakeTimers();
    const queue = new SerialQueue(100);
    await queue.run(async () => {}, 1);
    const background = queue.run(async () => 'background');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    const interactive = queue.run(async () => 'interactive', 1);
    await interactive;
    await vi.advanceTimersByTimeAsync(100);
    await background;
    expect(vi.getTimerCount()).toBe(0);
    expect(queue.snapshot()).toEqual({ running: [], queued: [] });
  });

  it('applies the grace period after failed interactive requests too', async () => {
    vi.useFakeTimers();
    const queue = new SerialQueue(100);
    await expect(queue.run(async () => { throw new Error('failed'); }, 1)).rejects.toThrow('failed');
    const task = vi.fn(async () => 'background');
    const background = queue.run(task);
    await vi.advanceTimersByTimeAsync(99);
    expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await background).toBe('background');
  });

  it.each([NaN, Infinity, -1])('rejects invalid grace period %s', (value) => {
    expect(() => new SerialQueue(value)).toThrow(RangeError);
  });

  it('rejects priorities that would leave tasks ineligible forever', async () => {
    const queue = new SerialQueue();
    await expect(queue.run(async () => {}, NaN)).rejects.toThrow(RangeError);
    await expect(queue.acquire(Infinity)).rejects.toThrow(RangeError);
    expect(queue.snapshot().queued).toEqual([]);
  });
});
