import { SettingsSection } from '../../components/SettingsUI';
import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, formatDate, useToast, Toast } from '../../components/AdminUI';
import { apiRequest } from '../../lib/api';
import type { ErrandsResponse, ErrandItem, ErrandState, ErrandTranscriptMessage, ErrandTranscriptResponse } from '../../lib/types';

const STALE_STATES: ErrandState[] = ['open', 'awaiting_peer', 'awaiting_principal', 'expired'];

function statusLabel(state: ErrandState): string {
  switch (state) {
    case 'draft': return 'awaiting your approval';
    case 'queued': return 'queued behind another errand';
    case 'open': return 'in progress';
    case 'awaiting_peer': return 'waiting on them';
    case 'awaiting_principal': return 'waiting on you';
    case 'resolved': return 'resolved';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'expired': return 'expired';
    default: return state;
  }
}

function statusClass(state: ErrandState): string {
  switch (state) {
    case 'awaiting_principal': return 'border-amber-500/40 bg-amber-500/10 text-amber-400';
    case 'awaiting_peer':
    case 'open': return 'border-accent/40 bg-accent-muted text-accent-2';
    case 'resolved': return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400';
    case 'failed':
    case 'expired': return 'border-red-500/40 bg-red-500/10 text-red-400';
    case 'cancelled': return 'border-subtle text-txt-3';
    default: return 'border-subtle text-txt-2';
  }
}

/** Stale/expired first, then by recency — a quiet errand needing you is
 * more important than a fresh one that's still moving. */
function sortErrands(items: ErrandItem[]): ErrandItem[] {
  return [...items].sort((a, b) => {
    const aStale = STALE_STATES.includes(a.state) ? 1 : 0;
    const bStale = STALE_STATES.includes(b.state) ? 1 : 0;
    if (aStale !== bStale) return bStale - aStale;
    const aTime = new Date(a.lastProgressAt ?? a.createdAt).getTime();
    const bTime = new Date(b.lastProgressAt ?? b.createdAt).getTime();
    return bTime - aTime;
  });
}

export function ErrandPendingMessage({ errand }: { errand: Pick<ErrandItem, 'state' | 'pendingMessage' | 'delivery'> }) {
  return <>
    {errand.pendingMessage && ['draft', 'queued', 'awaiting_principal'].includes(errand.state) && (
      <div className="mt-3 rounded-md border border-subtle p-3 text-xs">
        <div className="font-semibold text-txt-2">{errand.state === 'awaiting_principal' ? 'Question awaiting your answer' : 'Message to send'}</div>
        <div className="mt-1 whitespace-pre-wrap text-txt">{errand.pendingMessage}</div>
      </div>
    )}
    {errand.delivery && (
      <div role="status" className="mt-2 text-xs text-amber-400">
        {errand.delivery.error ?? 'Message delivery pending.'} {errand.delivery.sent}/{errand.delivery.total} contacts received the message.
        {' '}Retry sends the saved message only to the remaining contacts.
      </div>
    )}
  </>;
}

export default function ErrandsPage() {
  const [data, setData] = useState<ErrandsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, showToast, isError] = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedErrandId, setExpandedErrandId] = useState<string | null>(null);
  const [transcriptMessages, setTranscriptMessages] = useState<ErrandTranscriptMessage[]>([]);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiRequest<ErrandsResponse>('/errands?limit=50');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load errands');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleTranscript = async (id: string) => {
    if (expandedErrandId === id) {
      setExpandedErrandId(null);
      setTranscriptMessages([]);
      return;
    }

    setExpandedErrandId(id);
    setLoadingTranscript(true);
    try {
      const res = await apiRequest<ErrandTranscriptResponse>(`/errands/${id}/transcript`);
      setTranscriptMessages(res.messages);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load transcript', true);
      setTranscriptMessages([]);
    } finally {
      setLoadingTranscript(false);
    }
  };

  const submitAnswer = async (id: string) => {
    if (!answerText.trim() || busyId === id) return;
    setBusyId(id);
    try {
      await apiRequest<{ errand: ErrandItem; reply: string }>(`/errands/${id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ answer: answerText.trim() }),
      });
      showToast('Answer sent to contact, errand resumed');
      setAnsweringId(null);
      setAnswerText('');
      if (expandedErrandId === id) {
        void toggleTranscript(id);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send answer', true);
    } finally {
      setBusyId(null);
      void load();
    }
  };

  async function act(id: string, action: 'approve' | 'cancel' | 'close' | 'retry') {
    setBusyId(id);
    try {
      await apiRequest(`/errands/${id}/${action}`, { method: 'POST' });
      showToast(`Errand ${action === 'approve' ? 'approved' : action === 'retry' ? 'message delivered' : action === 'cancel' ? 'cancelled' : 'closed'}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Failed to ${action} errand`, true);
    } finally {
      setBusyId(null);
      void load();
    }
  }

  const items = data ? sortErrands(data.items) : [];

  return (
    <SettingsSection title="Errands" description="Delegated conversations koris is running on your behalf" onRefresh={load}>
      {error && <EmptyState text={error} />}
      {!error && !data && <EmptyState text="Loading…" />}
      {!error && data && items.length === 0 && (
        <EmptyState text="No errands yet. Start one with /errand <goal> with <contact> on <channel>." />
      )}
      {!error && items.length > 0 && (
        <div className="space-y-3">
          {items.map((errand) => (
            <Card key={errand.id} className="!p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass(errand.state)}`}>
                      {statusLabel(errand.state)}
                    </span>
                    <span className="font-mono text-[10px] text-txt-3">{errand.id.slice(0, 12)}…</span>
                    <span className="font-mono text-[10px] text-txt-3">· mother session: {errand.originSessionId.slice(0, 10)}…</span>
                  </div>
                  <div className="mt-1.5 text-sm text-txt">{errand.goal}</div>
                  <ErrandPendingMessage errand={errand} />
                  {errand.notes && (
                    <div className="mt-1 text-xs text-txt-2">
                      <span className="text-txt-3">notes: </span>{errand.notes}
                    </div>
                  )}
                  {errand.result && (
                    <div className="mt-1 text-xs text-txt-2">
                      <span className="text-txt-3">result: </span>{errand.result}
                    </div>
                  )}
                  <div className="mt-1.5 font-mono text-[10px] text-txt-3">
                    started {formatDate(errand.createdAt)}
                    {errand.lastProgressAt ? ` · last progress ${formatDate(errand.lastProgressAt)}` : ''}
                  </div>
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  {errand.delivery && (
                    <button disabled={busyId === errand.id} onClick={() => act(errand.id, 'retry')}
                      className="rounded-md border border-amber-500/40 px-2 py-1 text-xs text-amber-400 disabled:opacity-50">
                      Retry Send
                    </button>
                  )}
                  {errand.state === 'draft' && !errand.delivery && (
                    <button
                      disabled={busyId === errand.id}
                      onClick={() => act(errand.id, 'approve')}
                      className="rounded-md border border-accent/40 bg-accent-muted px-2 py-1 font-mono text-[11px] text-accent-2 hover:border-accent disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                  {errand.state === 'awaiting_principal' && !errand.delivery && (
                    <button
                      disabled={busyId === errand.id}
                      onClick={() => {
                        setAnsweringId(answeringId === errand.id ? null : errand.id);
                        setAnswerText('');
                      }}
                      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono text-[11px] text-amber-400 hover:border-amber-400 disabled:opacity-50"
                    >
                      {answeringId === errand.id ? 'Close Reply' : 'Answer'}
                    </button>
                  )}
                  {!['resolved', 'failed', 'cancelled', 'expired'].includes(errand.state) && (
                    <>
                      <button
                        disabled={busyId === errand.id}
                        onClick={() => act(errand.id, 'close')}
                        className="rounded-md border border-subtle px-2 py-1 font-mono text-[11px] text-txt-3 hover:border-emerald-500/40 hover:text-emerald-400 disabled:opacity-50"
                      >
                        Close
                      </button>
                      <button
                        disabled={busyId === errand.id}
                        onClick={() => act(errand.id, 'cancel')}
                        className="rounded-md border border-subtle px-2 py-1 font-mono text-[11px] text-txt-3 hover:border-red-500/40 hover:text-red-400 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>

              {answeringId === errand.id && !errand.delivery && errand.state === 'awaiting_principal' && (
                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                  <div className="text-xs font-semibold text-amber-400">
                    Reply to Escalation
                  </div>
                  <div className="mt-1 text-xs text-txt-2">
                    Provide instructions to resume the negotiation with the other party:
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      placeholder="e.g. Yes, confirm for Saturday at 10am..."
                      className="flex-1 rounded-md border border-subtle bg-bg px-2.5 py-1 text-xs text-txt focus:border-amber-400 focus:outline-none"
                      onKeyDown={(e) => { if (e.key === 'Enter') void submitAnswer(errand.id); }}
                    />
                    <button
                      disabled={busyId === errand.id || !answerText.trim()}
                      onClick={() => submitAnswer(errand.id)}
                      className="rounded-md border border-amber-500/50 bg-amber-500/20 px-3 py-1 font-mono text-[11px] text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
                    >
                      Send Answer
                    </button>
                    <button
                      onClick={() => { setAnsweringId(null); setAnswerText(''); }}
                      className="rounded-md border border-subtle px-2 py-1 font-mono text-[11px] text-txt-3 hover:text-txt"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {errand.targets && errand.targets.length > 0 && (
                <div className="mt-3 border-t border-subtle/60 pt-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-txt-3">
                    Child Sessions ({errand.targets.length})
                  </div>
                  <div className="mt-2 space-y-2">
                    {errand.targets.map((target) => (
                      <div key={target.sessionId} className="rounded-md border border-subtle bg-bg-2/50 p-2.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-accent/20 px-1.5 py-0.5 font-mono text-[10px] text-accent-2">
                              {target.channel}
                            </span>
                            <span className="font-mono text-txt">{target.peerId}</span>
                            <span className="text-[11px] text-txt-3">({target.messageCount} msg{target.messageCount === 1 ? '' : 's'})</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-txt-3">session: {target.sessionId.slice(0, 10)}…</span>
                            <button
                              onClick={() => toggleTranscript(errand.id)}
                              className="rounded border border-subtle px-2 py-0.5 font-mono text-[10px] text-txt-3 hover:border-accent hover:text-txt"
                            >
                              {expandedErrandId === errand.id ? 'Hide Chat' : 'View Chat'}
                            </button>
                          </div>
                        </div>

                        {expandedErrandId === errand.id && (
                          <div className="mt-2.5 rounded border border-subtle/80 bg-bg p-2.5 text-xs">
                            {loadingTranscript ? (
                              <div className="text-txt-3">Loading conversation…</div>
                            ) : transcriptMessages.length === 0 ? (
                              <div className="text-txt-3">No messages exchanged yet.</div>
                            ) : (
                              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                                {transcriptMessages.map((m) => (
                                  <div key={m.id} className={`flex flex-col ${m.role === 'assistant' ? 'items-end' : 'items-start'}`}>
                                    <span className="text-[10px] text-txt-3">
                                      {m.role === 'assistant' ? 'Koris (Negotiator)' : target.peerId} · {formatDate(m.createdAt)}
                                    </span>
                                    <div className={`mt-0.5 max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs ${
                                      m.role === 'assistant' ? 'bg-accent/20 text-txt' : 'bg-bg-3 text-txt'
                                    }`}>
                                      {m.content}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <Toast message={toastMsg} isError={isError} />
    </SettingsSection>
  );
}
