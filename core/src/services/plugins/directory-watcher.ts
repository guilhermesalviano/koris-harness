import { join } from 'node:path';

interface WatchHandle {
  close(): void;
}

interface DirectoryWatcherOptions {
  root: () => string;
  directories: () => string[];
  watch: (path: string, options: { persistent: true }, listener: () => void) => WatchHandle;
  onChange: () => void | Promise<void>;
  onError: (error: unknown) => void;
  debounceMs?: number;
}

/** Owns watch handles and the debounce timer; callers own discovery and sync. */
export class DirectoryWatcher {
  private handles: WatchHandle[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly options: DirectoryWatcherOptions) {}

  start(): void {
    this.running = true;
    this.refresh();
  }

  refresh(): void {
    if (!this.running) return;
    this.closeHandles();

    try {
      const root = this.options.root();
      this.handles.push(this.options.watch(root, { persistent: true }, this.schedule));
      for (const directory of this.options.directories()) {
        try {
          this.handles.push(this.options.watch(join(root, directory), { persistent: true }, this.schedule));
        } catch (error) {
          this.options.onError(error);
        }
      }
    } catch (error) {
      this.options.onError(error);
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.closeHandles();
  }

  private readonly schedule = (): void => {
    if (!this.running) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.running) return;
      try {
        Promise.resolve(this.options.onChange()).catch(this.options.onError);
      } catch (error) {
        this.options.onError(error);
      }
    }, this.options.debounceMs ?? 500);
  };

  private closeHandles(): void {
    for (const handle of this.handles) {
      try {
        handle.close();
      } catch (error) {
        this.options.onError(error);
      }
    }
    this.handles = [];
  }
}
