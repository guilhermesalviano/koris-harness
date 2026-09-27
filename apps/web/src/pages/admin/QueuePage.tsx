import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Card, EmptyState, StatCard } from '../../components/AdminUI';
import { Badge, type BadgeTone } from '../../components/ui';
import { cn } from '../../lib/cn';
import { apiRequest } from '../../lib/api';
import type { QueueResponse, QueueTaskInfo } from '../../lib/types';

const POLL_INTERVAL_MS = 1500;

function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-3 font-mono text-micro uppercase text-txt-3', className)}>{children}</div>;
}

function priorityInfo(priority: number): { label: string; tone: BadgeTone } {
  return priority >= 1 ? { label: 'interactive', tone: 'success' } : { label: 'background', tone: 'warn' };
}

function TaskChip({ task, muted = false }: { task: QueueTaskInfo; muted?: boolean }) {
  const prio = priorityInfo(task.priority);
  return (
    <div
      className={cn(
        'flex w-44 flex-col gap-2 rounded-panel border bg-bg-3 p-3',
        muted ? 'border-subtle opacity-50' : 'border-strong',
      )}
    >
      <span className="truncate font-mono text-caption text-txt">{task.label || 'unnamed'}</span>
      <div className="flex items-center gap-1.5">
        <Badge tone={prio.tone}>{prio.label}</Badge>
        {!task.eligible && <Badge>held</Badge>}
      </div>
    </div>
  );
}

function Processor({ running }: { running: QueueTaskInfo[] }) {
  if (running.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center rounded-panel border border-dashed border-subtle bg-bg font-mono text-caption text-txt-3">
        Idle — no LLM call in progress
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {running.map((task, index) => {
        const prio = priorityInfo(task.priority);
        return (
          <div
            key={`${task.label}-${index}`}
            className="flex items-center gap-3 rounded-panel border border-accent-muted bg-accent-muted p-4"
          >
            <span className="h-3 w-3 flex-shrink-0 animate-pulse rounded-full bg-accent" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-body text-txt">{task.label || 'unnamed'}</div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Badge tone={prio.tone}>{prio.label}</Badge>
                <span className="font-mono text-micro uppercase text-txt-3">running</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function QueuePanel({ onRegisterRefresh }: { onRegisterRefresh: (refresh: () => void) => void }) {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const subAgentQueuedLabels = data?.subAgents.flatMap((queue) => queue.queuedLabels) ?? [];
  const totalWaiting = data ? data.queued.length + subAgentQueuedLabels.length : 0;

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<QueueResponse>('/queue');
      setData(res);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue');
    }
  }, []);

  useEffect(() => {
    onRegisterRefresh(load);
  }, [onRegisterRefresh, load]);

  // The 1.5s poll lives and dies with this panel — switching tabs unmounts it.
  useEffect(() => {
    load();
    timerRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [load]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-micro text-txt-3">
        {lastUpdated && (
          <>
            <span>Last update: {lastUpdated.toLocaleTimeString()}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span>auto-refresh {POLL_INTERVAL_MS / 1000}s</span>
      </div>

      {error && <EmptyState text={error} />}
      {!error && !data && <EmptyState text="Loading…" />}
      {!error && data && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Provider mode" value={data.parallel ? 'Parallel' : 'Serialized'} hint="ai.parallel" />
            <StatCard label="LLM running" value={data.running.length} />
            <StatCard label="LLM waiting" value={totalWaiting} />
            <StatCard label="Grace period" value={`${data.backgroundGraceMs / 1000}s`} hint="background hold" />
          </div>

          <div className={cn('grid grid-cols-1 gap-4', !data.parallel && 'lg:grid-cols-2')}>
            <Card>
              <SectionTitle>Processor — LLM calls in flight ({data.running.length})</SectionTitle>
              <Processor running={data.running} />
            </Card>

            <Card>
              <SectionTitle>Waiting — LLM calls queued ({totalWaiting})</SectionTitle>
              <div className="flex flex-col gap-4">
                {!data.parallel &&
                  (data.queued.length === 0 ? (
                    <EmptyState text="Nothing waiting" />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {data.queued.map((task, index) => (
                        <TaskChip key={`${task.label}-${index}`} task={task} />
                      ))}
                    </div>
                  ))}
                {subAgentQueuedLabels.length > 0 && (
                  <div>
                    <SectionTitle className="mb-2">
                      Sub-agent tasks enqueued ({subAgentQueuedLabels.length})
                    </SectionTitle>
                    <div className="flex flex-wrap gap-2">
                      {subAgentQueuedLabels.map((label, index) => (
                        <TaskChip key={`sub-${label}-${index}`} task={{ label, priority: 0, eligible: true }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className="mt-4">
            <Card>
              <SectionTitle>How queueing works</SectionTitle>
              <ul className="list-inside list-disc space-y-1.5 text-body text-txt-2">
                <li>
                  <span className="font-mono text-txt">ai.parallel</span> controls the provider queue
                  (Processor/Waiting above). Off: one LLM call at a time. On: calls run concurrently.
                </li>
                <li>
                  <span className="font-mono text-txt">ai.subagents_parallel</span> controls the sub-agent queues. Off:
                  heartbeat and summarizer share one queue. On: each has its own.
                </li>
                <li>Sub-agents never run their own tasks concurrently — at most one task per queue at a time.</li>
              </ul>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
