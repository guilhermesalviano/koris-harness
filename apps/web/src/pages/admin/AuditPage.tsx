import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Card, EmptyState, formatDate, useToast, Toast } from '../../components/AdminUI';
import { Badge, Button, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import { apiRequest } from '../../lib/api';
import { useProviders } from '../../lib/use-providers';
import type { AuditItem, AuditResponse } from '../../lib/types';

const PAGE_SIZE = 50;

/** The system-prompt heading `PromptRepository` writes retrieved memories under. */
const MEMORY_CONTEXT_MARKER = '# Long-term Memory Context';

function typeLabel(type: string): string {
  return type === 'llm' ? 'LLM' : 'tool';
}

function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-2 font-mono text-micro uppercase text-txt-3', className)}>{children}</div>;
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={status === 'success' ? 'success' : 'danger'}>{status}</Badge>;
}

function Payload({ children }: { children: ReactNode }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-panel border border-subtle bg-bg-3 p-3 font-mono text-mini leading-relaxed text-txt-2">
      {children}
    </pre>
  );
}

function EmbedContextPanel() {
  const { active } = useProviders();
  const embed = active.embed;

  const rows: [string, string][] = [
    ['provider', embed.provider || '—'],
    ['model', embed.model || '—'],
    ['base url', embed.baseUrl || 'provider default'],
  ];

  return (
    <Card className="mb-4">
      <div className="mb-3 flex items-center gap-2">
        <SectionTitle className="mb-0">Embeddings (RAG)</SectionTitle>
        <Badge tone={embed.enabled ? 'success' : 'neutral'} dot>
          {embed.enabled ? 'enabled' : 'disabled'}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="font-mono text-micro uppercase text-txt-3">{label}</div>
            <div className="truncate font-mono text-caption text-txt-2">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-panel border border-info bg-info-muted px-3 py-2.5 text-mini leading-relaxed text-txt-2">
        <span className="font-medium text-txt">Tip — validate what embed context was used:</span> embedding retrieval
        isn't logged as its own audit entry. To see which memories a turn actually pulled in, open that turn's{' '}
        <span className="font-mono">LLM</span> entry below and look in the prompt for the{' '}
        <span className="font-mono">{MEMORY_CONTEXT_MARKER}</span> block — those bullets are exactly what semantic
        search injected.
        {embed.enabled ? (
          <>
            {' '}
            If the block is absent or empty, retrieval returned nothing: check the provider/model above is reachable and
            scan the server logs for <span className="font-mono">embed failed</span> or{' '}
            <span className="font-mono">mismatched embedding dimension</span>.
          </>
        ) : (
          <>
            {' '}
            Embeddings are disabled, so that block (when present) is the 20 most recent memories by recency, not a
            semantic match.
          </>
        )}
      </div>
    </Card>
  );
}

export default function AuditPanel({ onRegisterRefresh }: { onRegisterRefresh: (refresh: () => void) => void }) {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditItem | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [toastMsg, showToast, isError] = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      if (offset) params.set('offset', String(offset));
      if (type) params.set('type', type);
      if (status) params.set('status', status);
      const res = await apiRequest<AuditResponse>(`/audit?${params.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    }
  }, [type, status, offset]);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailError(null);
    setDetail(null);
    try {
      const res = await apiRequest<AuditItem>(`/audit/${id}`);
      setDetail(res);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load entry');
    }
  }, []);

  const refresh = useCallback(() => {
    load();
    if (selectedId) loadDetail(selectedId);
  }, [load, loadDetail, selectedId]);

  useEffect(() => {
    onRegisterRefresh(refresh);
  }, [onRegisterRefresh, refresh]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  function applyFilters(nextType: string, nextStatus: string) {
    setType(nextType);
    setStatus(nextStatus);
    setOffset(0);
    setSelectedId(null);
    setDetail(null);
  }

  async function deleteEntry(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Delete this audit entry?')) return;
    try {
      await apiRequest(`/audit/${id}`, { method: 'DELETE' });
      showToast('Entry deleted');
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', true);
    }
  }

  async function clearAll() {
    if (!confirm('Delete ALL audit entries?')) return;
    try {
      await apiRequest('/audit', { method: 'DELETE' });
      showToast('Audit log cleared');
      setSelectedId(null);
      setDetail(null);
      setOffset(0);
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Clear failed', true);
    }
  }

  return (
    <>
      <EmbedContextPanel />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by entry type"
          value={type}
          onChange={(e) => applyFilters(e.target.value, status)}
          className="h-8 w-auto text-caption"
        >
          <option value="">all types</option>
          <option value="llm">LLM</option>
          <option value="tool">tool</option>
        </Select>
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => applyFilters(type, e.target.value)}
          className="h-8 w-auto text-caption"
        >
          <option value="">all statuses</option>
          <option value="success">success</option>
          <option value="error">error</option>
        </Select>
        <div className="ml-auto font-mono text-mini text-txt-3">{data ? `${data.total} entries` : ''}</div>
      </div>

      {error && <EmptyState text={error} />}
      {!error && !data && <EmptyState text="Loading…" />}
      {!error && data && data.items.length === 0 && <EmptyState text="No audit entries." />}
      {!error && data && data.items.length > 0 && (
        <>
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-subtle text-left font-mono text-micro uppercase text-txt-3">
                    <th className="px-3 py-2.5 font-medium">Time</th>
                    <th className="px-3 py-2.5 font-medium">Type</th>
                    <th className="px-3 py-2.5 font-medium">Role · Agent</th>
                    <th className="px-3 py-2.5 font-medium">Provider / Model</th>
                    <th className="px-3 py-2.5 font-medium">Prompt</th>
                    <th className="px-3 py-2.5 font-medium">Response</th>
                    <th className="px-3 py-2.5 font-medium">Dur</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={item.id}
                      className={cn(
                        'cursor-pointer border-b border-subtle transition-colors hover:bg-bg-3/60',
                        selectedId === item.id && 'bg-bg-3',
                      )}
                      onClick={() => loadDetail(item.id)}
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-mini text-txt-2">
                        {formatDate(item.createdAt)}
                      </td>
                      <td className="px-3 py-2 font-mono text-mini text-txt">{typeLabel(item.type)}</td>
                      <td className="px-3 py-2 text-mini">
                        <span className="font-mono text-txt-2">{item.role}</span>
                        {item.agentName && <span className="text-txt-3"> · {item.agentName}</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-mini text-txt-2">
                        {item.type === 'llm'
                          ? `${item.provider ?? '?'}${item.model ? ` / ${item.model}` : ''}`
                          : item.toolName}
                      </td>
                      <td className="max-w-[240px] truncate px-3 py-2 font-mono text-mini text-txt-2">
                        {item.promptPreview ?? item.toolArgs ?? ''}
                      </td>
                      <td className="max-w-[240px] truncate px-3 py-2 font-mono text-mini text-txt-2">
                        {item.responsePreview ?? ''}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-mini text-txt-3">{item.durationMs}ms</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => deleteEntry(item.id, e)}
                          className="hover:bg-danger-muted hover:text-danger"
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

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={clearAll} className="hover:bg-danger-muted hover:text-danger">
              Clear all
            </Button>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                ‹ Prev
              </Button>
              <span className="font-mono text-mini tabular-nums text-txt-3">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)}
              </span>
              <Button
                size="sm"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next ›
              </Button>
            </div>
          </div>
        </>
      )}

      {selectedId && (
        <div className="mt-4">
          {detailError && <EmptyState text={detailError} />}
          {!detailError && !detail && <EmptyState text="Loading entry…" />}
          {!detailError && detail && (
            <Card>
              <div className="mb-4 flex items-center gap-2">
                <SectionTitle className="mb-0">Entry {detail.id.slice(0, 12)}…</SectionTitle>
                <StatusBadge status={detail.status} />
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-mini text-txt-2 md:grid-cols-4">
                <div>
                  <span className="text-txt-3">time </span>
                  {formatDate(detail.createdAt)}
                </div>
                <div>
                  <span className="text-txt-3">type </span>
                  {typeLabel(detail.type)}
                </div>
                <div>
                  <span className="text-txt-3">role </span>
                  {detail.role} {detail.agentName && `· ${detail.agentName}`}
                </div>
                <div>
                  <span className="text-txt-3">channel </span>
                  {detail.channel ?? '—'}
                </div>
                <div>
                  <span className="text-txt-3">runId </span>
                  {detail.runId ?? '—'}
                </div>
                <div>
                  <span className="text-txt-3">sessionId </span>
                  {detail.sessionId ?? '—'}
                </div>
                <div>
                  <span className="text-txt-3">duration </span>
                  {detail.durationMs}ms
                </div>
                <div>
                  <span className="text-txt-3">model </span>
                  {detail.model ?? detail.provider ?? '—'}
                </div>
                {detail.finishReason && (
                  <div>
                    <span className="text-txt-3">finish </span>
                    {detail.finishReason}
                  </div>
                )}
                {detail.type === 'llm' && (
                  <div>
                    <span className="text-txt-3">memory ctx </span>
                    {detail.prompt?.includes(MEMORY_CONTEXT_MARKER) ? 'injected' : 'none'}
                  </div>
                )}
                {detail.toolCalls !== undefined && (
                  <div>
                    <span className="text-txt-3">toolCalls </span>
                    {detail.toolCalls}
                  </div>
                )}
                {detail.toolsEnabled !== undefined && (
                  <div>
                    <span className="text-txt-3">tools </span>
                    {detail.toolsEnabled ? 'enabled' : 'off'}
                  </div>
                )}
                {detail.errorCode && (
                  <div className="text-danger">
                    <span className="text-txt-3">error </span>
                    {detail.errorCode}
                  </div>
                )}
                {detail.errorMessage && <div className="col-span-3 break-all text-danger">{detail.errorMessage}</div>}
              </div>

              {detail.type === 'llm' ? (
                <>
                  <div className="mt-4">
                    <SectionTitle>Prompt ({detail.promptLength ?? 0} chars)</SectionTitle>
                    <Payload>{prettyJson(detail.prompt)}</Payload>
                  </div>
                  <div className="mt-4">
                    <SectionTitle>Response ({detail.responseLength ?? 0} chars)</SectionTitle>
                    <Payload>{prettyJson(detail.response)}</Payload>
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-4">
                    <SectionTitle>Tool args</SectionTitle>
                    <Payload>{prettyJson(detail.toolArgs)}</Payload>
                  </div>
                  <div className="mt-4">
                    <SectionTitle>Result {detail.success ? '(ok)' : '(failed)'}</SectionTitle>
                    <Payload>{detail.response}</Payload>
                  </div>
                </>
              )}
            </Card>
          )}
        </div>
      )}

      <Toast message={toastMsg} isError={isError} />
    </>
  );
}

function prettyJson(value?: string | null): string {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
