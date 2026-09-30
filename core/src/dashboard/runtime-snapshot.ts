import { config } from '../config';
import { sharedSerialQueue } from '../services/providers/serial-queue';
import { subAgentQueuesRegistry } from '../services/agents/sub-agents/queue/sub-agent-queue-registry';

export function getQueueStatus() {
  return {
    parallel: config.AI.PARALLEL,
    subagentsParallel: config.AI.SUBAGENTS_PARALLEL,
    backgroundGraceMs: config.AI.BACKGROUND_GRACE_MS,
    subAgents: subAgentQueuesRegistry.getSnapshot(),
    ...sharedSerialQueue.snapshot(),
  };
}

export type QueueStatus = ReturnType<typeof getQueueStatus>;
