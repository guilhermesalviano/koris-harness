import { useCallback, useEffect, useRef, type ReactNode, useState } from 'react';
import { Card, EmptyState, StatCard, formatDate } from '../../components/AdminUI';
import { Badge } from '../../components/ui';
import { cn } from '../../lib/cn';
import { apiRequest } from '../../lib/api';
import type { OverviewResponse } from '../../lib/types';

const POLL_INTERVAL_MS = 10_000;

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours >= 48 ? `${(hours / 24).toFixed(1)}d` : `${hours}h ${minutes % 60}m`;
}

function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-3 font-mono text-micro uppercase text-txt-3', className)}>{children}</div>;
}

function StatusPill({ on, label }: { on: boolean; label?: string }) {
  return (
    <Badge tone={on ? 'success' : 'neutral'} dot>
      {label ?? (on ? 'on' : 'off')}
    </Badge>
  );
}

/** Label/value row used by the provider and usage cards. */
function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-body text-txt-2">{label}</span>
      <span className="truncate font-mono text-caption text-txt">{value}</span>
    </div>
  );
}

function LiveActivity({ data }: { data: OverviewResponse }) {
  const queue = data.queue;
  const subAgentQueuedLabels = queue.subAgents.flatMap((q) => q.queuedLabels);
  const totalWaiting = queue.queued.length + subAgentQueuedLabels.length;

  return (
    <Card>
      <SectionTitle>Live activity</SectionTitle>

      <div className="mb-4 flex flex-wrap gap-2">
        <StatusPill
          on={data.activeRuns.length > 0}
          label={`${data.activeRuns.length} active run${data.activeRuns.length === 1 ? '' : 's'}`}
        />
        <StatusPill on={queue.running.length > 0} label={`${queue.running.length} LLM running`} />
        <StatusPill on={totalWaiting > 0} label={`${totalWaiting} LLM waiting`} />
      </div>

      {data.activeRuns.length === 0 ? (
        <EmptyState text="No runs in progress" />
      ) : (
        <div className="space-y-2">
          {data.activeRuns.map((run) => (
            <div key={run.id} className="rounded-panel border border-accent-muted bg-accent-muted px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-accent" />
                <span className="truncate text-body text-txt">{run.question || 'Untitled run'}</span>
              </div>
              <div className="mt-1 font-mono text-micro text-txt-3">
                {run.channel} · started {formatDate(run.startedAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      {queue.running.length > 0 && (
        <div className="mt-4">
          <SectionTitle className="mb-2">In-flight LLM calls</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {queue.running.map((task, index) => (
              <Badge key={`${task.label}-${index}`} tone="accent">
                {task.label || 'unnamed'}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function UsageSummary({ data }: { data: OverviewResponse }) {
  const usage = data.usage;
  return (
    <Card>
      <SectionTitle>Usage — last 7 days</SectionTitle>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        <Row label="LLM calls" value={usage.calls} />
        <Row label="Tool calls" value={usage.toolCalls} />
        <Row label="Tokens" value={formatTokens(usage.totalTokens)} />
        <Row label="Time" value={formatDuration(usage.durationMs)} />
      </div>
    </Card>
  );
}

function ProvidersCard({ data }: { data: OverviewResponse }) {
  return (
    <Card>
      <SectionTitle>Providers</SectionTitle>
      <div className="space-y-2">
        <Row label="Manager" value={`${data.provider} · ${data.model}`} />
        <Row label="Workers" value={`${data.workerProvider} · ${data.workerModel}`} />
        <Row label="Environment" value={data.environment} />
        <Row label="Timezone" value={data.timezone} />
      </div>
    </Card>
  );
}

function ConfigCard({ data }: { data: OverviewResponse }) {
  return (
    <Card>
      <SectionTitle>Config &amp; channels</SectionTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusPill on={data.heartbeatEnabled} label="heartbeat" />
        <StatusPill on={data.summarizerEnabled} label="summarizer" />
        <StatusPill on={data.aiParallel} label="ai.parallel" />
        <StatusPill on={data.aiSubagentsParallel} label="subagents_parallel" />
      </div>
      {data.channels.length > 0 && (
        <div className="mb-4 space-y-2">
          {data.channels.map((channel) => (
            <div key={channel.type} className="flex items-center justify-between gap-3">
              <span className="font-mono text-caption text-txt-2">{channel.type}</span>
              <StatusPill on={channel.enabled} />
            </div>
          ))}
        </div>
      )}
      {data.registeredChannels.length > 0 && (
        <div className="space-y-2">
          <SectionTitle className="mb-2">Connected channels</SectionTitle>
          {data.registeredChannels.map((channel) => (
            <div key={`${channel.type}:${channel.target}`} className="flex items-center justify-between gap-3">
              <span className="truncate font-mono text-caption text-txt-2">{channel.target}</span>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                {channel.principal && <Badge tone="accent">principal</Badge>}
                <span className="font-mono text-micro text-txt-3">{channel.type}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function HealthCard({ data }: { data: OverviewResponse }) {
  const ok = data.health.status === 'ok';
  const details = data.health.details;

  return (
    <Card>
      <SectionTitle>Health</SectionTitle>
      <Badge tone={ok ? 'success' : 'danger'} dot>
        {data.health.status}
      </Badge>
      {details !== undefined && details !== null && (
        <pre className="mt-3 max-h-40 overflow-auto rounded-panel bg-bg-3 p-3 font-mono text-mini text-txt-2">
          {typeof details === 'string' ? details : JSON.stringify(details, null, 2)}
        </pre>
      )}
      {ok && details === undefined && <div className="mt-3 text-mini text-txt-3">Provider reachable.</div>}
    </Card>
  );
}

function RecentErrorsCard({ data }: { data: OverviewResponse }) {
  const errors = data.recentErrors;

  return (
    <Card>
      <SectionTitle>Recent errors</SectionTitle>
      {errors.length === 0 ? (
        <EmptyState text="No recent errors" />
      ) : (
        <div className="space-y-2">
          {errors.map((error) => (
            <div key={error.id} className="rounded-panel border border-danger bg-danger-muted px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-caption text-danger">
                  {error.agentName ?? 'unknown'}
                  {error.type && <span className="text-txt-3"> · {error.type}</span>}
                </span>
                <span className="flex-shrink-0 font-mono text-micro text-txt-3">{formatDate(error.createdAt)}</span>
              </div>
              {(error.errorMessage || error.errorCode) && (
                <div className="mt-1 truncate font-mono text-mini text-txt-2">
                  {error.errorCode && <span className="text-txt-3">{error.errorCode} · </span>}
                  {error.errorMessage}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function OverviewPanel({ onRegisterRefresh }: { onRegisterRefresh: (refresh: () => void) => void }) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiRequest<OverviewResponse>('/overview');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load overview');
    }
  }, []);

  useEffect(() => {
    onRegisterRefresh(load);
  }, [onRegisterRefresh, load]);

  // Polling is owned by this panel, so it stops the moment the tab is switched
  // away and this component unmounts.
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
      <div className="mb-4 font-mono text-micro text-txt-3">auto-refresh {POLL_INTERVAL_MS / 1000}s</div>

      {error && <EmptyState text={error} />}
      {!error && !data && <EmptyState text="Loading…" />}
      {!error && data && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Sessions" value={data.sessions} hint={`${data.openSessions} open`} />
            <StatCard label="Messages" value={data.messages} />
            <StatCard label="Memories" value={data.memories} />
            <StatCard label="Beats" value={data.heartbeats} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
            <StatCard
              label="Learned skills"
              value={`${data.learnedSkills}/${data.learnedSkillsLimit}`}
              hint="of limit"
            />
            <StatCard label="Available skills" value={data.skills} />
            <Card className="p-4">
              <div className="font-mono text-micro uppercase text-txt-3">Audit errors</div>
              <div
                className={cn(
                  'mt-2 text-display font-semibold tabular-nums',
                  data.auditErrors > 0 ? 'text-danger' : 'text-txt',
                )}
              >
                {data.auditErrors}
              </div>
              {data.auditErrors > 0 && <div className="mt-1 text-mini text-txt-2">see the Audit tab</div>}
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <LiveActivity data={data} />
            <UsageSummary data={data} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ProvidersCard data={data} />
            <ConfigCard data={data} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <HealthCard data={data} />
            <RecentErrorsCard data={data} />
          </div>
        </>
      )}
    </>
  );
}
