import { SettingsSection } from '../../components/SettingsUI';
import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, formatDate, useToast, Toast } from '../../components/AdminUI';
import { Badge, Button } from '../../components/ui';
import { apiRequest } from '../../lib/api';
import type { SessionsResponse, SessionDetailResponse } from '../../lib/types';

function PanelLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 font-mono text-micro uppercase text-txt-3">{children}</div>;
}

export default function SessionsPage() {
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [toastMsg, showToast, isError] = useToast();
  const parentSessionId = typeof detail?.session.metadata.parentSessionId === 'string' ? detail.session.metadata.parentSessionId : null;
  const instructions = typeof detail?.session.metadata.instructions === 'string' ? detail.session.metadata.instructions : null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiRequest<SessionsResponse>('/sessions?limit=50');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailError(null);
    setDetail(null);
    try {
      const res = await apiRequest<SessionDetailResponse>(`/sessions/${id}`);
      setDetail(res);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load session');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Delete this session and all its messages?')) return;
    try {
      await apiRequest(`/sessions/${id}`, { method: 'DELETE' });
      showToast('Session deleted');
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', true);
    }
  }

  return (
    <SettingsSection title="Sessions" description="All conversations and their details" onRefresh={() => { load(); if (selectedId) loadDetail(selectedId); }}>
      {error && <EmptyState text={error} />}
      {!error && !data && <EmptyState text="Loading…" />}
      {!error && data && data.items.length === 0 && <EmptyState text="No sessions yet." />}
      {!error && data && data.items.length > 0 && (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-subtle text-left font-mono text-micro uppercase text-txt-3">
                  <th className="px-4 py-3 font-semibold">ID</th>
                  <th className="px-4 py-3 font-semibold">Channel</th>
                  <th className="px-4 py-3 font-semibold">Peer</th>
                  <th className="px-4 py-3 font-semibold">Kind</th>
                  <th className="px-4 py-3 font-semibold">Started</th>
                  <th className="px-4 py-3 font-semibold">Ended</th>
                  <th className="px-4 py-3 font-semibold">Msgs</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} className="cursor-pointer border-b border-subtle/60 transition-colors hover:bg-bg-3/60" onClick={() => loadDetail(s.id)}>
                    <td className="px-4 py-3 font-mono text-caption text-txt-2">{s.id.slice(0, 12)}…</td>
                    <td className="px-4 py-3 text-body text-txt">{s.channel}</td>
                    <td className="px-4 py-3 font-mono text-caption text-txt-2">{s.peerId}</td>
                    <td className="px-4 py-3 text-body">
                      {s.kind === 'delegated' ? (
                        <span title="Child delegated session for an errand">
                          <Badge tone="accent">errand child</Badge>
                        </span>
                      ) : (
                        <span className="text-txt-3">user</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-caption text-txt-2">{formatDate(s.startedAt)}</td>
                    <td className="px-4 py-3 font-mono text-caption text-txt-2">
                      {s.endedAt ? formatDate(s.endedAt) : <Badge tone="success" dot>open</Badge>}
                    </td>
                    <td className="px-4 py-3 text-body tabular-nums text-txt">{s.messageCount}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete session"
                        onClick={(e) => deleteSession(s.id, e)}
                        className="border-subtle text-txt-3 hover:bg-danger-muted hover:text-danger-2"
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {selectedId && (
        <div className="mt-6">
          {detailError && <EmptyState text={detailError} />}
          {!detailError && !detail && <EmptyState text="Loading session…" />}
          {!detailError && detail && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {(parentSessionId || instructions) && (
                <Card className="md:col-span-2">
                  {parentSessionId && (
                    <button className="text-sm text-accent-2 hover:underline" onClick={() => loadDetail(parentSessionId)}>
                      Open parent session · {parentSessionId}
                    </button>
                  )}
                  {instructions && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-txt-2">Session instructions</summary>
                      <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap text-sm text-txt-2">{instructions}</div>
                    </details>
                  )}
                </Card>
              )}
              <Card>
                <PanelLabel>Messages</PanelLabel>
                <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
                  {detail.messages.length === 0 && <EmptyState text="No messages." />}
                  {detail.messages.map((m) => (
                    <div key={m.id} className="rounded-panel border border-subtle bg-bg-3 px-3 py-2.5">
                      <div className="font-mono text-micro uppercase text-txt-3">{m.role} · {formatDate(m.createdAt)}</div>
                      <div className="mt-1.5 whitespace-pre-wrap text-body text-txt">{m.content}</div>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <PanelLabel>Memories</PanelLabel>
                <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
                  {detail.memories.length === 0 && <EmptyState text="No memories." />}
                  {detail.memories.map((m) => (
                    <div key={m.id} className="rounded-panel border border-subtle bg-bg-3 px-3 py-2.5">
                      <div className="font-mono text-micro uppercase text-txt-3">{m.type} · {formatDate(m.createdAt)}</div>
                      <div className="mt-1.5 whitespace-pre-wrap text-body text-txt">{m.content}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      <Toast message={toastMsg} isError={isError} />
    </SettingsSection>
  );
}
