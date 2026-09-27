import { config } from '../../config';

interface QueueTask {
  fn: () => Promise<unknown>;
  priority: number;
  label: string;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export interface QueueTaskInfo {
  label: string;
  priority: number;
  eligible: boolean;
}

export interface QueueSnapshot {
  running: QueueTaskInfo[];
  queued: QueueTaskInfo[];
}

const INTERACTIVE_THRESHOLD = 1;

class SerialQueue {
  private tasks: QueueTask[] = [];
  private running = false;
  private inFlight = new Map<number, QueueTaskInfo>();
  private nextTaskId = 0;
  private lastInteractiveEnd = 0;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeWait: (() => void) | null = null;

  constructor(
    private readonly backgroundGraceMs = 0,
    private readonly trackParallelFromConfig = false,
  ) {}

  run<T>(fn: () => Promise<T>, priority = 0, label = ''): Promise<T> {
    return this.enqueue(fn, priority, label);
  }

  acquire(priority = 0, label = ''): Promise<() => void> {
    if (this.isParallelMode) {
      const id = this.startInFlight(priority, label);
      return Promise.resolve(() => {
        this.endInFlight(id);
      });
    }

    return new Promise<() => void>((resolveAcquire) => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      this.enqueue(async () => {
        resolveAcquire(release);
        await gate;
      }, priority, label);
    });
  }

  private enqueue<T>(fn: () => Promise<T>, priority: number, label: string): Promise<T> {
    if (this.isParallelMode) {
      return this.runParallel(fn, priority, label);
    }

    return new Promise<T>((resolve, reject) => {
      this.tasks.push({
        fn: fn as () => Promise<unknown>,
        priority,
        label,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.wakeWait?.();
      this.pump();
    });
  }

  private runParallel<T>(fn: () => Promise<T>, priority: number, label: string): Promise<T> {
    const id = this.startInFlight(priority, label);
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        this.endInFlight(id);
      });
  }

  private startInFlight(priority: number, label: string): number {
    const id = this.nextTaskId++;
    this.inFlight.set(id, { label, priority, eligible: true });
    return id;
  }

  private endInFlight(id: number): void {
    this.inFlight.delete(id);
  }

  snapshot(): QueueSnapshot {
    const running = Array.from(this.inFlight.values());
    const queued = this.tasks
      .map((task, index) => ({ task, index }))
      .sort((a, b) => b.task.priority - a.task.priority || a.index - b.index)
      .map(({ task }) => ({
        label: task.label,
        priority: task.priority,
        eligible: this.isEligible(task),
      }));
    return { running, queued };
  }

  private get isParallelMode(): boolean {
    return this.trackParallelFromConfig && config.AI.PARALLEL;
  }

  private isInteractive(priority: number): boolean {
    return priority >= INTERACTIVE_THRESHOLD;
  }

  private isEligible(task: QueueTask): boolean {
    if (this.isInteractive(task.priority)) {
      return true;
    }
    return Date.now() >= this.lastInteractiveEnd + this.backgroundGraceMs;
  }

  private pump(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    queueMicrotask(() => { void this.drain(); });
  }

  private async drain(): Promise<void> {
    while (this.tasks.length > 0) {
      const index = this.nextIndex();
      if (index === -1) {
        await this.waitUntilEligible();
        continue;
      }
      const [task] = this.tasks.splice(index, 1);
      const id = this.startInFlight(task.priority, task.label);
      try {
        task.resolve(await task.fn());
        if (this.isInteractive(task.priority)) {
          this.lastInteractiveEnd = Date.now();
        }
      } catch (err) {
        task.reject(err);
      } finally {
        this.endInFlight(id);
      }
    }
    this.running = false;
  }

  private nextIndex(): number {
    let index = -1;
    let bestPriority = -Infinity;
    for (let i = 0; i < this.tasks.length; i++) {
      const task = this.tasks[i];
      if (this.isEligible(task) && task.priority > bestPriority) {
        bestPriority = task.priority;
        index = i;
      }
    }
    return index;
  }

  private waitUntilEligible(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.waitTimer !== null) {
        clearTimeout(this.waitTimer);
      }
      let earliest = Infinity;
      for (const task of this.tasks) {
        const at = this.isInteractive(task.priority)
          ? Date.now()
          : this.lastInteractiveEnd + this.backgroundGraceMs;
        if (at < earliest) {
          earliest = at;
        }
      }
      const delay = Math.max(0, earliest - Date.now());
      this.wakeWait = resolve;
      this.waitTimer = setTimeout(() => {
        this.waitTimer = null;
        this.wakeWait = null;
        resolve();
      }, delay);
    });
  }
}

const sharedSerialQueue = new SerialQueue(config.AI.BACKGROUND_GRACE_MS, true);

export { SerialQueue, sharedSerialQueue };