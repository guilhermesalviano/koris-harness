export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'error';

export type SaveDraft<T> = {
  value: T;
  state: SaveState;
  error: string | null;
  version: number;
};

type SaveEntry = SaveDraft<unknown> & {
  baseline: string;
  hydrated: string;
  ready: boolean;
  timer?: ReturnType<typeof setTimeout>;
  write?: (value: unknown, baseline: unknown) => Promise<void>;
};

export class SaveCoordinator {
  private entries = new Map<string, SaveEntry>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private running: Promise<void> | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.revision;

  get<T>(key: string): SaveDraft<T> | undefined {
    return this.entries.get(key) as SaveDraft<T> | undefined;
  }

  states() {
    return [...this.entries.entries()].map(([key, entry]) => ({ key, state: entry.state, error: entry.error }));
  }

  hydrate<T>(key: string, value: T) {
    const fingerprint = JSON.stringify(value);
    const entry = this.entries.get(key);
    if (entry) {
      if (entry.hydrated === fingerprint) return;
      entry.hydrated = fingerprint;
      if (entry.state !== 'idle' && entry.state !== 'saved') return;
      entry.value = value;
      entry.baseline = fingerprint;
    } else {
      this.entries.set(key, { value, state: 'idle', error: null, version: 0, baseline: fingerprint, hydrated: fingerprint, ready: false });
    }
    this.emit();
  }

  schedule<T>(key: string, value: T, write: (value: T, baseline: T | undefined) => Promise<void>, options: { immediate?: boolean; error?: string | null } = {}) {
    const previous = this.entries.get(key);
    if (previous?.timer) clearTimeout(previous.timer);
    const entry: SaveEntry = {
      value,
      version: (previous?.version ?? 0) + 1,
      baseline: previous?.baseline ?? '',
      hydrated: previous?.hydrated ?? '',
      state: options.error ? 'invalid' : 'pending',
      error: options.error ?? null,
      ready: false,
      write: write as (value: unknown, baseline: unknown) => Promise<void>,
    };
    this.entries.set(key, entry);
    if (!options.error) {
      if (!this.running && JSON.stringify(value) === entry.baseline) {
        entry.state = 'saved';
      } else if (options.immediate) {
        entry.ready = true;
        this.start();
      } else {
        entry.timer = setTimeout(() => {
          entry.ready = true;
          this.start();
        }, 600);
      }
    }
    this.emit();
  }

  flush(prefix = ''): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(prefix) || entry.state !== 'pending') continue;
      if (entry.timer) clearTimeout(entry.timer);
      entry.ready = true;
    }
    return this.start();
  }

  retry(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (entry?.state === 'error') {
      entry.state = 'pending';
      entry.error = null;
      entry.ready = true;
      this.emit();
    }
    return this.start();
  }

  private emit() {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  private start(): Promise<void> {
    if (!this.running) {
      this.running = Promise.resolve().then(() => this.drain()).finally(() => { this.running = null; });
    }
    return this.running;
  }

  private async drain() {
    let next: [string, SaveEntry] | undefined;
    while ((next = [...this.entries].find(([, entry]) => entry.ready && entry.write))) {
      const [key, entry] = next;
      entry.ready = false;
      entry.state = 'saving';
      this.emit();
      try {
        await entry.write!(entry.value, entry.baseline ? JSON.parse(entry.baseline) : undefined);
        const latest = this.entries.get(key)!;
        latest.baseline = JSON.stringify(entry.value);
        if (latest.version === entry.version) {
          latest.state = 'saved';
          latest.error = null;
        }
      } catch (error) {
        const latest = this.entries.get(key)!;
        if (latest.version === entry.version) {
          latest.state = 'error';
          latest.error = error instanceof Error ? error.message : 'Could not save this change.';
        }
      }
      this.emit();
    }
  }
}
