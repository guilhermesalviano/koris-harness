import { TaskQueue } from './task-queue';

export interface SubAgentQueueState {
  names: string[];
  queued: number;
  active: number;
  concurrency: number;
  queuedLabels: string[];
  activeLabels: string[];
}

class SubAgentQueueRegistry {
  private readonly queues = new Map<string, TaskQueue>();

  register(name: string, queue: TaskQueue): void {
    this.queues.set(name, queue);
  }

  unregister(name: string): void {
    this.queues.delete(name);
  }

  getSnapshot(): SubAgentQueueState[] {
    const byQueue = new Map<TaskQueue, { names: string[] } & ReturnType<TaskQueue['snapshot']>>();
    for (const [name, queue] of this.queues.entries()) {
      const existing = byQueue.get(queue);
      if (existing) {
        existing.names.push(name);
      } else {
        byQueue.set(queue, { names: [name], ...queue.snapshot() });
      }
    }
    return Array.from(byQueue.values());
  }
}

const subAgentQueuesRegistry = new SubAgentQueueRegistry();

export { subAgentQueuesRegistry };