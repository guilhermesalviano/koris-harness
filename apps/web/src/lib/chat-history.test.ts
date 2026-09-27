import { describe, expect, it, vi } from 'vitest';
import { createHistoryPoller, mapMessages, mergeMessages, nextId, type ChatMessage, type HistoryMessage, type HistoryPollState } from './chat-history';

function saved(id: string, content = id, role = 'assistant', at = 1000): HistoryMessage {
  return { id, content, role, createdAt: new Date(at).toISOString() };
}

function local(content: string, role: 'user' | 'assistant' = 'assistant', props: Partial<ChatMessage> = {}): ChatMessage {
  return { id: nextId(), content, role, timestamp: '12:00', at: 2000, ...props };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('chat history reconciliation', () => {
  it('receives errand notices when the latest-200 window has the same length', () => {
    const history = Array.from({ length: 200 }, (_, i) => saved(`m${i}`, `message ${i}`, 'assistant', i));
    const current = mapMessages(history);
    const notice = saved('errand-result', 'Errand resolved: booked for Saturday.', 'assistant', 201);
    const merged = mergeMessages(current, [...history.slice(1), notice]);

    expect(merged).toHaveLength(201);
    expect(merged[0]).toBe(current[0]);
    expect(merged[merged.length - 1]?.serverId).toBe('errand-result');
    expect(merged[merged.length - 1]?.content).toContain('booked for Saturday');
    expect(mergeMessages(merged, [...history.slice(1), notice])).toBe(merged);
  });

  it('reconciles optimistic replies by identity without duplicating them or hiding notices', () => {
    const old = saved('old');
    const user = local('/errand approve e1', 'user');
    const reply = local('Errand is awaiting_peer');
    const current = [...mapMessages([old]), user, reply];
    const merged = mergeMessages(current, [
      old,
      saved('notice', 'What time works for you?', 'assistant', 2500),
      saved('user', user.content, 'user', 3000),
      saved('reply', reply.content, 'assistant', 3001),
    ]);

    expect(merged).toHaveLength(4);
    expect(merged.find((m) => m.serverId === 'user')).toMatchObject({ id: user.id, at: user.at });
    expect(merged.find((m) => m.serverId === 'reply')).toMatchObject({ id: reply.id, at: reply.at });
    expect(merged.find((m) => m.serverId === 'notice')?.content).toBe('What time works for you?');
  });

  it('preserves pending replies and local request failures when shorter history gains a notice', () => {
    const pending = local('Still thinking', 'assistant', { pending: true });
    const failure = local('Network failed', 'assistant', { error: true });
    const merged = mergeMessages([pending, failure], [saved('notice', 'Errand needs your input')]);
    expect(merged).toContain(pending);
    expect(merged).toContain(failure);
    expect(merged.some((m) => m.serverId === 'notice')).toBe(true);
  });

  it('matches repeated text one-to-one and never reuses a known server message', () => {
    const old = saved('old', 'yes', 'user');
    const first = local('yes', 'user');
    const second = local('yes', 'user');
    const current = [...mapMessages([old]), first, second];
    expect(mergeMessages(current, [old])).toBe(current);
    const merged = mergeMessages(current, [old, saved('first', 'yes', 'user', 3000), saved('second', 'yes', 'user', 3001)]);
    expect(merged).toHaveLength(3);
    expect(merged.find((m) => m.id === first.id)?.serverId).toBe('first');
    expect(merged.find((m) => m.id === second.id)?.serverId).toBe('second');
  });

  it('does not consume a local message when loading older matching history', () => {
    const anchor = saved('anchor', 'latest saved', 'assistant', 1500);
    const optimistic = local('yes', 'user');
    const current = [...mapMessages([anchor]), optimistic];
    const merged = mergeMessages(current, [saved('older', 'yes', 'user'), anchor]);
    expect(merged).toHaveLength(3);
    expect(merged.find((m) => m.id === optimistic.id)?.serverId).toBeUndefined();
  });

  it('distinguishes messages with different image attachments', () => {
    const optimistic = local('describe', 'user', { images: [{ data: 'local-image', mimeType: 'image/png' }] });
    const history = [{ ...saved('other', 'describe', 'user'), images: [{ data: 'other-image', mimeType: 'image/png' }] }];
    expect(mergeMessages([optimistic], history)).toHaveLength(2);
  });

  it('reconciles persisted provider errors while preserving local-only errors', () => {
    const error = local('Rate limited', 'assistant', { error: true });
    const merged = mergeMessages([error], [{ ...saved('error', 'Rate limited'), errorCode: 'rate_limited' }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: error.id, serverId: 'error', error: true });
  });
});

describe('background history polling', () => {
  function setup() {
    const state: HistoryPollState = { sessionId: 'chat-a', generation: 0, busy: false };
    let messages: ChatMessage[] = [];
    const fetchHistory = vi.fn<((sessionId: string) => Promise<HistoryMessage[]>)>().mockResolvedValue([]);
    const update = vi.fn((apply: (current: ChatMessage[]) => ChatMessage[]) => { messages = apply(messages); });
    const poller = createHistoryPoller({ getState: () => ({ ...state }), fetchHistory, update });
    return { state, fetchHistory, update, poller, getMessages: () => messages };
  }

  it('discards a delayed response after switching from chat A to chat B', async () => {
    const { state, fetchHistory, update, poller } = setup();
    const pending = deferred<HistoryMessage[]>();
    fetchHistory.mockReturnValueOnce(pending.promise);
    const run = poller.poll();
    state.sessionId = 'chat-b';
    pending.resolve([saved('notice-a')]);
    await run;
    expect(update).not.toHaveBeenCalled();
  });

  it('discards a response when navigating away and back to the same chat', async () => {
    const { state, fetchHistory, update, poller } = setup();
    const pending = deferred<HistoryMessage[]>();
    fetchHistory.mockReturnValueOnce(pending.promise);
    const run = poller.poll();
    state.generation += 2;
    pending.resolve([saved('stale')]);
    await run;
    expect(update).not.toHaveBeenCalled();
  });

  it('also guards React updates queued before navigation', async () => {
    const { state, fetchHistory, update, poller } = setup();
    fetchHistory.mockResolvedValue([saved('notice-a')]);
    await poller.poll();
    const apply = update.mock.calls[0][0];
    state.sessionId = 'chat-b';
    const chatB = mapMessages([saved('message-b')]);
    expect(apply(chatB)).toBe(chatB);
  });

  it('does not overlap requests or overwrite a reply that starts and finishes during a poll', async () => {
    const { state, fetchHistory, update, poller } = setup();
    const pending = deferred<HistoryMessage[]>();
    fetchHistory.mockReturnValueOnce(pending.promise);
    const run = poller.poll();
    await poller.poll();
    expect(fetchHistory).toHaveBeenCalledTimes(1);
    state.generation += 1;
    pending.resolve([saved('stale')]);
    await run;
    expect(update).not.toHaveBeenCalled();
  });

  it('catches up after a viewed-session stream finishes and retries fetch failures', async () => {
    const { state, fetchHistory, poller, getMessages } = setup();
    state.busy = true;
    await poller.poll();
    expect(fetchHistory).not.toHaveBeenCalled();
    state.busy = false;
    fetchHistory.mockRejectedValueOnce(new Error('Offline'));
    await poller.poll();
    fetchHistory.mockResolvedValue([saved('question', 'What time works?')]);
    await poller.poll();
    expect(getMessages().map((m) => m.serverId)).toEqual(['question']);
    await poller.poll();
    expect(getMessages()).toHaveLength(1);
  });

  it('discards in-flight responses when the poller is disposed', async () => {
    const { fetchHistory, update, poller } = setup();
    const pending = deferred<HistoryMessage[]>();
    fetchHistory.mockReturnValueOnce(pending.promise);
    const run = poller.poll();
    poller.dispose();
    pending.resolve([saved('stale')]);
    await run;
    await poller.poll();
    expect(update).not.toHaveBeenCalled();
    expect(fetchHistory).toHaveBeenCalledTimes(1);
  });
});
