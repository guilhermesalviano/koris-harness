import { afterEach, describe, expect, it } from 'vitest';
import { TaskQueue } from '../../../../../../src/services/agents/sub-agents/queue/task-queue';
import { SubAgentQueueState, subAgentQueuesRegistry } from '../../../../../../src/services/agents/sub-agents/queue/sub-agent-queue-registry';

afterEach(() => {
  subAgentQueuesRegistry.getSnapshot().forEach((state) => {
    state.names.forEach((name) => subAgentQueuesRegistry.unregister(name));
  });
});

describe('subAgentQueuesRegistry', () => {
  it('register followed by unregister removes the queue from the snapshot', () => {
    subAgentQueuesRegistry.register('test-heartbeat', new TaskQueue(1));
    expect(snapshotNames()).toContain('test-heartbeat');

    subAgentQueuesRegistry.unregister('test-heartbeat');
    expect(snapshotNames()).not.toContain('test-heartbeat');
  });

  it('groups queue names that share the same TaskQueue instance', () => {
    const shared = new TaskQueue(1);
    subAgentQueuesRegistry.register('test-heartbeat', shared);
    subAgentQueuesRegistry.register('test-summarizer', shared);

    const grouped = subAgentQueuesRegistry
      .getSnapshot()
      .filter((state) => state.names.includes('test-heartbeat') && state.names.includes('test-summarizer'));
    expect(grouped).toHaveLength(1);
  });
});

function snapshotNames(): string[] {
  return subAgentQueuesRegistry.getSnapshot().flatMap((state: SubAgentQueueState) => state.names);
}