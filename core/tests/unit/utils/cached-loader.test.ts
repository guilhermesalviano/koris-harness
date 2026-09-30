import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCachedLoader } from '../../../src/utils/cached-loader';

afterEach(() => vi.useRealTimers());

describe('createCachedLoader', () => {
  it('shares an in-flight fetch and starts the TTL when the fetch completes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const get = createCachedLoader({ load, ttlMs: 100, fallback: () => 'empty' });
    const first = get();
    const second = get();
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();
    vi.setSystemTime(200);
    resolve('loaded');
    expect(await first).toBe('loaded');
    expect(await second).toBe('loaded');
    vi.setSystemTime(299);
    expect(await get()).toBe('loaded');
    expect(load).toHaveBeenCalledOnce();
  });

  it('serves stale data on failure without caching the failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce('old')
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('new');
    const get = createCachedLoader({ load, ttlMs: 100, fallback: () => 'empty' });
    expect(await get()).toBe('old');
    vi.setSystemTime(100);
    expect(await get()).toBe('old');
    expect(await get()).toBe('new');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('falls back on an initial failure and retries the next request', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('recovered');
    const get = createCachedLoader({ load, ttlMs: 100, fallback: () => 'empty' });
    expect(await get()).toBe('empty');
    expect(await get()).toBe('recovered');
  });
});
