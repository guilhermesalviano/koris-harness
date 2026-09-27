import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, formatDate, useToast, Toast } from '../../components/AdminUI';
import { SettingsSection } from '../../components/SettingsUI';
import { Badge, Button } from '../../components/ui';
import { apiRequest } from '../../lib/api';
import type { MemoriesResponse } from '../../lib/types';

export default function MemoriesPage() {
  const [data, setData] = useState<MemoriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, showToast, isError] = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiRequest<MemoriesResponse>('/memories');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteMemory(id: string) {
    try {
      await apiRequest(`/memories/${id}`, { method: 'DELETE' });
      showToast('Memory deleted');
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', true);
    }
  }

  return (
    <SettingsSection title="Memories" description="Long-term memory: summaries, facts, lessons and reminders" onRefresh={load}>
      {error && <EmptyState text={error} />}
      {!error && !data && <EmptyState text="Loading…" />}
      {!error && data && data.items.length === 0 && <EmptyState text="No memories yet." />}
      {!error && data && data.items.length > 0 && (
        <Card className="flex flex-col gap-3 p-4">
          {data.items.map((m) => (
            <div key={m.id} className="flex items-start justify-between gap-3 rounded-panel border border-subtle bg-bg-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{m.type}</Badge>
                  <span className="font-mono text-micro uppercase text-txt-3">
                    session {(m.sessionId ?? '').slice(0, 8)}… · {formatDate(m.createdAt)}
                  </span>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-body text-txt">{m.content}</div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Delete memory"
                onClick={() => deleteMemory(m.id)}
                className="border-subtle text-txt-3 hover:bg-danger-muted hover:text-danger-2"
              >
                Delete
              </Button>
            </div>
          ))}
        </Card>
      )}
      <Toast message={toastMsg} isError={isError} />
    </SettingsSection>
  );
}
