import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, formatDate, useToast, Toast } from '../../components/AdminUI';
import { SettingsSection } from '../../components/SettingsUI';
import { apiRequest } from '../../lib/api';
import { useChannelOptions } from '../../lib/use-channel-options';
import type { HeartbeatsResponse } from '../../lib/types';

const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Every day at 9 AM',    cron: '0 9 * * *'   },
  { label: 'Every Monday at 9 AM', cron: '0 9 * * 1'   },
  { label: 'Every hour',           cron: '0 * * * *'   },
  { label: 'Every 6 hours',        cron: '0 */6 * * *' },
  { label: 'Every weekday at 8 AM',cron: '0 8 * * 1-5' },
  { label: 'Custom…',              cron: '__custom__'   },
];

function cronToLabel(cron: string): string {
  const preset = CRON_PRESETS.find((p) => p.cron === cron && p.cron !== '__custom__');
  if (preset) return preset.label;
  return cron; // fall back to raw cron if no preset matches
}

const TYPE_META: Record<'reminder' | 'scheduled_beat', { label: string; hint: string }> = {
  reminder: {
    label: 'Reminder',
    hint: 'The agent sends a one-shot message to a channel at the scheduled time.',
  },
  scheduled_beat: {
    label: 'Scheduled task',
    hint: 'The agent runs a full task (like research or a report) on a recurring schedule.',
  },
};

function friendlyDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const absDiff = Math.abs(diffMs);
  const minutes = Math.round(absDiff / 60_000);
  const hours = Math.round(absDiff / 3_600_000);
  const days = Math.round(absDiff / 86_400_000);

  const future = diffMs > 0;
  if (minutes < 2) return future ? 'in a moment' : 'just now';
  if (minutes < 60) return future ? `in ${minutes} min` : `${minutes} min ago`;
  if (hours < 24) return future ? `in ${hours} h` : `${hours} h ago`;
  if (days === 1) return future ? 'tomorrow' : 'yesterday';
  if (days < 7) return future ? `in ${days} days` : `${days} days ago`;
  return formatDate(value);
}

export default function HeartbeatsPage() {
  const [data, setData] = useState<HeartbeatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [beat, setBeat] = useState('');
  const [cronPreset, setCronPreset] = useState(CRON_PRESETS[0].cron);
  const [cronCustom, setCronCustom] = useState('');
  const [type, setType] = useState<'reminder' | 'scheduled_beat'>('reminder');
  const [channel, setChannel] = useState('');
  const [target, setTarget] = useState('');

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const channelOptions = useChannelOptions();
  const [toastMsg, showToast, isError] = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiRequest<HeartbeatsResponse>('/heartbeats');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load beats');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cronExpression = cronPreset === '__custom__' ? cronCustom : cronPreset;

  async function createBeat(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/heartbeats', {
        method: 'POST',
        body: JSON.stringify({
          beat,
          cronExpression,
          type,
          channel: channel || undefined,
          target: target || undefined,
        }),
      });
      showToast('Beat created');
      setBeat('');
      setCronPreset(CRON_PRESETS[0].cron);
      setCronCustom('');
      setType('reminder');
      setChannel('');
      setTarget('');
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Create failed', true);
    }
  }

  async function deleteBeat(id: string) {
    try {
      await apiRequest(`/heartbeats/${id}`, { method: 'DELETE' });
      showToast('Beat deleted');
      setPendingDeleteId(null);
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', true);
    }
  }

  const typeMeta = TYPE_META[type];

  return (
    <SettingsSection
      title="Beats"
      description="Beats are scheduled tasks that run automatically — send reminders, generate reports, or trigger any action on a timer."
      onRefresh={load}
    >
      {/* ── Create form ── */}
      <Card className="mb-6">
        <p className="mb-4 text-sm font-medium text-txt">New beat</p>
        <form onSubmit={createBeat} className="flex flex-col gap-4">

          {/* Instructions */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-txt-2">
              What should the agent do?
            </label>
            <textarea
              required
              rows={3}
              value={beat}
              onChange={(e) => setBeat(e.target.value)}
              placeholder={'E.g. \u201cSend me a motivational quote\u201d, \u201cSummarise today\u2019s news and post it\u201d, or \u201cCheck if the API is responding and alert me if it\u2019s down\u201d'}
              className="w-full resize-none rounded-xl border border-strong bg-bg-3/60 px-3 py-2.5 text-[13px] text-txt outline-none transition-colors placeholder:text-txt-3 focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </div>

          {/* Type picker */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-txt-2">Type</label>
            <div className="flex gap-2">
              {(Object.keys(TYPE_META) as (keyof typeof TYPE_META)[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setType(key)}
                  className={`flex-1 rounded-xl border px-3 py-2.5 text-left text-[13px] transition-colors ${
                    type === key
                      ? 'border-accent-muted bg-accent-muted text-accent-2'
                      : 'border-strong bg-bg-3/60 text-txt-2 hover:border-accent hover:text-txt'
                  }`}
                >
                  <span className="block font-medium">{TYPE_META[key].label}</span>
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-txt-3">{typeMeta.hint}</p>
          </div>

          {/* Schedule */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-txt-2">Schedule</label>
            <select
              value={cronPreset}
              onChange={(e) => setCronPreset(e.target.value)}
              className="w-full rounded-xl border border-strong bg-bg-3/60 px-3 py-2.5 text-[13px] text-txt outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/15"
            >
              {CRON_PRESETS.map((p) => (
                <option key={p.cron} value={p.cron}>{p.label}</option>
              ))}
            </select>
            {cronPreset === '__custom__' && (
              <div className="mt-1.5 flex flex-col gap-1">
                <input
                  required
                  value={cronCustom}
                  onChange={(e) => setCronCustom(e.target.value)}
                  placeholder="Cron expression — e.g. 0 9 * * 1"
                  className="w-full rounded-xl border border-strong bg-bg-3/60 px-3 py-2.5 font-mono text-[13px] text-txt outline-none transition-colors placeholder:text-txt-3 focus:border-accent focus:ring-2 focus:ring-accent/15"
                />
                <p className="text-xs text-txt-3">
                  Format: <code className="font-mono">minute hour day month weekday</code>.{' '}
                  <a
                    href="https://crontab.guru"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-2 underline-offset-2 hover:underline"
                  >
                    crontab.guru
                  </a>{' '}
                  can help you build one.
                </p>
              </div>
            )}
          </div>

          {/* Delivery (optional) */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-txt-2">
              Delivery channel{' '}
              <span className="font-normal text-txt-3">(optional — leave blank to use the default)</span>
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="w-full rounded-xl border border-strong bg-bg-3/60 px-3 py-2.5 text-[13px] text-txt outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/15 sm:w-48"
              >
                <option value="">Any channel</option>
                {channelOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {channel && (
                <input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="Recipient ID (phone number, group name, chat ID…)"
                  className="w-full flex-1 rounded-xl border border-strong bg-bg-3/60 px-3 py-2.5 text-[13px] text-txt outline-none transition-colors placeholder:text-txt-3 focus:border-accent focus:ring-2 focus:ring-accent/15"
                />
              )}
            </div>
          </div>

          <button
            type="submit"
            className="self-start rounded-xl bg-accent px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            Create beat
          </button>
        </form>
      </Card>

      {/* ── Beat list ── */}
      <div>
        {error && <EmptyState text={error} />}
        {!error && !data && <EmptyState text="Loading…" />}
        {!error && data && data.items.length === 0 && (
          <Card>
            <EmptyState text="No beats scheduled yet. Create one above to get started." />
          </Card>
        )}
        {!error && data && data.items.length > 0 && (
          <div className="flex flex-col gap-3">
            {data.items.map((h) => {
              const isDeleting = pendingDeleteId === h.id;
              return (
                <Card key={h.id} className="!p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {/* Beat instructions */}
                      <p className="whitespace-pre-wrap text-[13px] text-txt">{h.beat}</p>

                      {/* Human-readable metadata row */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-1 rounded-md bg-bg-3 px-2 py-0.5 text-[11px] font-medium text-txt-2">
                          {TYPE_META[h.type as keyof typeof TYPE_META]?.label ?? h.type}
                        </span>
                        <span className="text-[11px] text-txt-2">
                          🕐 {cronToLabel(h.cron_expression)}
                        </span>
                        {h.run_once && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-bg-3 px-2 py-0.5 text-[11px] font-medium text-txt-2">
                            One-time
                          </span>
                        )}
                        {h.channel && (
                          <span className="text-[11px] text-txt-2">
                            📡 {h.channel}{h.target ? `: ${h.target}` : ''}
                          </span>
                        )}
                      </div>

                      {/* Next / last run */}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-txt-3">
                        <span>Next run: <span className="text-txt-2">{friendlyDate(h.next_run)}</span></span>
                        <span>Last run: <span className="text-txt-2">{friendlyDate(h.last_run)}</span></span>
                      </div>
                    </div>

                    {/* Delete with confirmation */}
                    <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                      {isDeleting ? (
                        <>
                          <span className="text-[11px] text-txt-2">Delete this beat?</span>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => deleteBeat(h.id)}
                              className="rounded-md border border-red-500/40 px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/10"
                            >
                              Yes, delete
                            </button>
                            <button
                              onClick={() => setPendingDeleteId(null)}
                              className="rounded-md border border-subtle px-2.5 py-1 text-[11px] text-txt-2 hover:bg-bg-3"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={() => setPendingDeleteId(h.id)}
                          className="rounded-md border border-subtle px-2.5 py-1 text-[11px] text-txt-3 hover:border-red-500/40 hover:text-red-400"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Toast message={toastMsg} isError={isError} />
    </SettingsSection>
  );
}
