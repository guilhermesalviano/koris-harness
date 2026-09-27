import type { ImageAttachment } from './types';

export interface ChatMessage {
  id: number;
  /** Persisted identity; local optimistic messages acquire it during reconciliation. */
  serverId?: string;
  role: 'user' | 'assistant';
  content: string;
  images?: ImageAttachment[];
  missingImages?: number;
  status?: string;
  pending?: boolean;
  error?: boolean;
  /** Display-only "HH:MM" caption; empty while a reply is pending. */
  timestamp: string;
  /** Creation time in epoch ms, for the thread's time separators. */
  at: number;
  backgroundRunKey?: string;
}

export type HistoryMessage = {
  id: string;
  role: string;
  content: string;
  images?: ImageAttachment[];
  missingImages?: number;
  errorCode?: string;
  createdAt: string;
};

let idCounter = 0;
export function nextId(): number {
  return ++idCounter;
}

export function timeStr(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function mapMessages(messages: HistoryMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    id: nextId(),
    serverId: m.id,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
    images: m.images,
    missingImages: m.missingImages,
    error: !!m.errorCode,
    timestamp: timeStr(new Date(m.createdAt)),
    at: new Date(m.createdAt).getTime(),
  }));
}

/** Merge the server's bounded history without dropping older loaded messages or
 * local errors. A saved copy of an optimistic message takes over its existing UI
 * identity; only previously unseen server IDs can claim an optimistic message. */
export function mergeMessages(current: ChatMessage[], history: HistoryMessage[]): ChatMessage[] {
  const knownIds = new Set(current.flatMap((message) => message.serverId ? [message.serverId] : []));
  const unseen = history.filter((message) => !knownIds.has(message.id));
  if (unseen.length === 0) return current;

  const merged = [...current];
  // Do not match old history against a newly sent message with the same text.
  // The latest common saved message separates loaded history from local turns.
  const lastKnownIndex = history.reduce((last, message, index) => knownIds.has(message.id) ? index : last, -1);
  const olderIds = new Set(history.slice(0, lastKnownIndex + 1).map((message) => message.id));
  for (const saved of unseen) {
    const role = saved.role === 'user' ? 'user' : 'assistant';
    const localIndex = olderIds.has(saved.id) ? -1 : merged.findIndex((message) => (
      !message.serverId && !message.pending && !!message.error === !!saved.errorCode
      && message.role === role && message.content === saved.content
      && JSON.stringify(message.images ?? []) === JSON.stringify(saved.images ?? [])
    ));
    const message = mapMessages([saved])[0];
    if (localIndex >= 0) {
      // Keep the local timestamp/order: persistence can happen after a notice
      // arrived, or a long-running response finished.
      merged[localIndex] = { ...message, id: merged[localIndex].id, at: merged[localIndex].at, timestamp: merged[localIndex].timestamp };
    } else {
      merged.push(message);
    }
  }
  return merged.sort((a, b) => a.at - b.at);
}

export interface HistoryPollState {
  sessionId: string | null;
  generation: number;
  busy: boolean;
}

/** One in-flight request, with a view/turn generation guard both on receipt and
 * when React applies the update. `busy` belongs to the viewed session only. */
export function createHistoryPoller(options: {
  getState: () => HistoryPollState;
  fetchHistory: (sessionId: string) => Promise<HistoryMessage[]>;
  update: (apply: (current: ChatMessage[]) => ChatMessage[]) => void;
}) {
  let running = false;
  let disposed = false;
  return {
    async poll(): Promise<void> {
      const state = options.getState();
      if (disposed || running || state.busy || !state.sessionId) return;
      const isCurrent = () => {
        const latest = options.getState();
        return !disposed && !latest.busy && latest.sessionId === state.sessionId && latest.generation === state.generation;
      };
      running = true;
      try {
        const history = await options.fetchHistory(state.sessionId);
        if (isCurrent()) options.update((current) => isCurrent() ? mergeMessages(current, history) : current);
      } catch {
        // Retry on the next poll, preserving the visible transcript.
      } finally {
        running = false;
      }
    },
    dispose() { disposed = true; },
  };
}
