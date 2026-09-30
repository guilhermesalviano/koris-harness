import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectoryWatcher } from '../../../../src/services/plugins/directory-watcher';

function makeWatcher(onChange = vi.fn<() => void | Promise<void>>()) {
  const listeners: (() => void)[] = [];
  const handles: { close: ReturnType<typeof vi.fn> }[] = [];
  const watch = vi.fn((_path: string, _options: unknown, listener: () => void) => {
    listeners.push(listener);
    const handle = { close: vi.fn() };
    handles.push(handle);
    return handle;
  });
  const onError = vi.fn();
  const watcher = new DirectoryWatcher({
    root: () => '/plugins', directories: () => ['first', 'second'], watch, onChange, onError,
  });
  return { watcher, watch, handles, listeners, onChange, onError };
}

afterEach(() => vi.useRealTimers());

describe('DirectoryWatcher', () => {
  it('coalesces events from different directories and cancels pending work on stop', async () => {
    vi.useFakeTimers();
    const { watcher, listeners, handles, onChange } = makeWatcher();
    watcher.start();
    listeners[0]();
    listeners[1]();
    await vi.advanceTimersByTimeAsync(500);
    expect(onChange).toHaveBeenCalledOnce();

    listeners[2]();
    watcher.stop();
    listeners[0](); // A queued callback from a closed handle must be ignored.
    await vi.advanceTimersByTimeAsync(500);
    expect(onChange).toHaveBeenCalledOnce();
    for (const handle of handles) expect(handle.close).toHaveBeenCalledOnce();
  });

  it('keeps watching other directories when one child cannot be watched', () => {
    const { watcher, watch, onError } = makeWatcher();
    const error = new Error('folder disappeared');
    watch.mockImplementationOnce(() => ({ close: vi.fn() }))
      .mockImplementationOnce(() => { throw error; });
    watcher.start();
    expect(watch).toHaveBeenLastCalledWith('/plugins/second', { persistent: true }, expect.any(Function));
    expect(onError).toHaveBeenCalledWith(error);
    watcher.stop();
  });

  it('closes old handles on refresh and releases the rest if one close throws', () => {
    const { watcher, handles, onError } = makeWatcher();
    watcher.start();
    handles[0].close.mockImplementation(() => { throw new Error('already closed'); });
    watcher.refresh();
    expect(handles[1].close).toHaveBeenCalledOnce();
    expect(handles[2].close).toHaveBeenCalledOnce();
    expect(handles).toHaveLength(6);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'already closed' }));
    watcher.stop();
  });

  it.each(['sync', 'async'])('reports a %s background sync failure', async (mode) => {
    vi.useFakeTimers();
    const error = new Error('sync failed');
    const onChange = vi.fn(() => {
      if (mode === 'async') return Promise.reject(error);
      throw error;
    });
    const { watcher, listeners, onError } = makeWatcher(onChange);
    watcher.start();
    listeners[0]();
    await vi.advanceTimersByTimeAsync(500);
    expect(onError).toHaveBeenCalledWith(error);
    watcher.stop();
  });
});
