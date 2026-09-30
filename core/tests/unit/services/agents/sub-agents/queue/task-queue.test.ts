import { describe, expect, it, vi } from 'vitest';
import { TaskQueue } from '../../../../../../src/services/agents/sub-agents/queue/task-queue';

describe('TaskQueue', () => {
  it.each([0, -1, 1.5, NaN, Infinity])('rejects concurrency %s rather than stalling tasks', (concurrency) => {
    expect(() => new TaskQueue(concurrency)).toThrow(RangeError);
  });

  it('continues queued work after a task throws synchronously', async () => {
    const queue = new TaskQueue(1);
    const failure = queue.add(() => { throw new Error('failed'); });
    const next = vi.fn(async () => 'next');
    const success = queue.add(next);
    await expect(failure).rejects.toThrow('failed');
    expect(await success).toBe('next');
    expect(next).toHaveBeenCalledOnce();
  });
});
