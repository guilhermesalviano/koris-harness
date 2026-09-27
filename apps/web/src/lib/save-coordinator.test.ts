import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveCoordinator } from './save-coordinator';

describe('configuration automatic saving', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not write hydrated values and coalesces typing after 600 ms', async () => {
    const saves = new SaveCoordinator();
    const write = vi.fn(async () => {});
    saves.hydrate('general.domains', 'old.example');
    await saves.flush();
    expect(write).not.toHaveBeenCalled();
    saves.schedule('general.domains', 'first.example', write);
    await vi.advanceTimersByTimeAsync(500);
    saves.schedule('general.domains', 'last.example', write);
    await vi.advanceTimersByTimeAsync(599);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledExactlyOnceWith('last.example', 'old.example');
    expect(saves.get('general.domains')?.state).toBe('saved');
  });

  it('writes discrete selections immediately and flushes text before navigation', async () => {
    const saves = new SaveCoordinator();
    const write = vi.fn(async () => {});
    saves.schedule('skills.mode', 'manual', write, { immediate: true });
    await saves.flush();
    saves.schedule('general.domains', '', write);
    await saves.flush();
    expect(write.mock.calls).toHaveLength(2);
    expect(saves.get('general.domains')).toMatchObject({ value: '', state: 'saved' });
  });

  it('serializes writes, preserves newer drafts, and uses the acknowledged baseline', async () => {
    const saves = new SaveCoordinator();
    let release!: () => void;
    const write = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
    saves.hydrate('providers.manager', 'original');
    saves.schedule('providers.manager', 'first', write, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    saves.schedule('providers.manager', 'latest', write);
    saves.hydrate('providers.manager', 'stale response');
    expect(saves.get('providers.manager')?.value).toBe('latest');
    await vi.advanceTimersByTimeAsync(600);
    expect(write).toHaveBeenCalledTimes(1);
    release();
    await saves.flush();
    expect(write).toHaveBeenLastCalledWith('latest', 'first');
    expect(saves.get('providers.manager')).toMatchObject({ value: 'latest', state: 'saved' });
  });

  it('does not let a failed older write erase a newer edit', async () => {
    const saves = new SaveCoordinator();
    let reject!: (error: Error) => void;
    const write = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; })).mockResolvedValue(undefined);
    saves.schedule('skills.limit', '20', write, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    saves.schedule('skills.limit', '30', write, { immediate: true });
    reject(new Error('Offline'));
    await saves.flush();
    expect(saves.get('skills.limit')).toMatchObject({ value: '30', state: 'saved', error: null });
  });

  it('retains errors and retries the latest value without a new edit', async () => {
    const saves = new SaveCoordinator();
    const write = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined);
    saves.schedule('general.domains', 'example.com', write, { immediate: true });
    await saves.flush();
    expect(saves.get('general.domains')).toMatchObject({ value: 'example.com', state: 'error', error: 'Offline' });
    saves.hydrate('general.domains', 'server.example');
    await saves.retry('general.domains');
    expect(write).toHaveBeenLastCalledWith('example.com', undefined);
    expect(saves.get('general.domains')?.state).toBe('saved');
  });

  it('keeps invalid drafts across flushes and still saves unrelated fields', async () => {
    const saves = new SaveCoordinator();
    const write = vi.fn(async () => {});
    saves.schedule('skills.limit', '0', write, { error: 'Must be positive' });
    saves.schedule('skills.mode', 'manual', write, { immediate: true });
    await saves.flush();
    await saves.retry('skills.limit');
    expect(write).toHaveBeenCalledTimes(1);
    expect(saves.get('skills.limit')).toMatchObject({ value: '0', state: 'invalid' });
    saves.schedule('skills.limit', '8', write);
    await saves.flush();
    expect(saves.get('skills.limit')?.state).toBe('saved');
  });

  it('saves a return to the original value while an earlier write is in flight', async () => {
    const saves = new SaveCoordinator();
    let release!: () => void;
    const write = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
    saves.hydrate('skills.mode', 'auto');
    saves.schedule('skills.mode', 'manual', write, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    saves.schedule('skills.mode', 'auto', write, { immediate: true });
    release();
    await saves.flush();
    expect(write).toHaveBeenLastCalledWith('auto', 'manual');
  });
});
