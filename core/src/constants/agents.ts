export type AgentId = 'orchestrator' | 'negotiator' | 'watcher';

export interface AgentDescriptor {
  id: AgentId;
  name: string;
  description: string;
  /** Parent agent in the roster tree; `null` for top-level agents. */
  parentId: AgentId | null;
  /** Whether the principal can message this agent directly from the web chat. */
  messageable: boolean;
}

/**
 * Roster shown in the web sidebar. There is no runtime agent registry, so this
 * is the single place that names the agents and how they nest. The Summarizer
 * has no screen; its memories are listed with the `/memories` command.
 */
export const AGENTS: readonly AgentDescriptor[] = [
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    description: 'Main agent. Talks with you and delegates work to the sub-agents.',
    parentId: null,
    messageable: true,
  },
  {
    id: 'negotiator',
    name: 'Negotiator',
    description: 'Runs errands with your contacts on your behalf.',
    parentId: 'orchestrator',
    messageable: false,
  },
  {
    id: 'watcher',
    name: 'Watcher (Heartbeat)',
    description: 'Runs scheduled beats in the background.',
    parentId: 'orchestrator',
    messageable: false,
  },
];
