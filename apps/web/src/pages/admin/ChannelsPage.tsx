import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, formatDate, useToast, Toast } from '../../components/AdminUI';
import { Badge, Button, Field, Input, Select, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { apiRequest } from '../../lib/api';
import { useSettingsForm } from '../../lib/use-settings-form';
import { ChannelsStep } from '../setup/steps/ChannelsStep';
import { SettingsSection } from '../../components/SettingsUI';
import { useSaveCoordinator } from '../../lib/config-save-context';
import type { ChannelsResponse, OutboundResponse } from '../../lib/types';

function SectionTitle({ children }: { children: string }) {
  return <h2 className="mb-3 mt-8 text-lead font-semibold text-txt first:mt-0">{children}</h2>;
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 font-mono text-micro uppercase text-txt-3">{children}</div>;
}

export default function ChannelsPage() {
  const settings = useSettingsForm();
  const saves = useSaveCoordinator();
  const [data, setData] = useState<ChannelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outbound, setOutbound] = useState<OutboundResponse | null>(null);
  const [outboundError, setOutboundError] = useState<string | null>(null);
  const [channel, setChannel] = useState('');
  const [target, setTarget] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [toastMsg, showToast, isError] = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiRequest<ChannelsResponse>('/channels'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channels');
    }
  }, []);

  const loadOutbound = useCallback(async () => {
    setOutboundError(null);
    try {
      setOutbound(await apiRequest<OutboundResponse>('/outbound'));
    } catch (err) {
      setOutboundError(err instanceof Error ? err.message : 'Failed to load outbound messages');
    }
  }, []);

  useEffect(() => {
    load();
    loadOutbound();
  }, [load, loadOutbound]);

  async function setPrincipal(id: string) {
    try {
      await apiRequest(`/channels/${id}/principal`, { method: 'PATCH' });
      showToast('Principal channel updated');
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', true);
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await apiRequest('/outbound', {
        method: 'POST',
        body: JSON.stringify({
          content,
          channel: channel || undefined,
          target: target || undefined,
        }),
      });
      showToast('Message sent');
      setChannel('');
      setTarget('');
      setContent('');
      loadOutbound();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Send failed', true);
    } finally {
      setSending(false);
    }
  }

  const principal = data?.items.find((c) => c.isPrincipal);

  return (
    <SettingsSection
      title="Channels"
      description="Connected messaging channels and outbound messages"
      onRefresh={() => {
        void saves.flush().then(() => { load(); loadOutbound(); settings.reload(); });
      }}
    >
      <SectionTitle>Channel configuration</SectionTitle>
      {settings.loadError && <EmptyState text={settings.loadError} />}
      {settings.loading && !settings.loadError && <EmptyState text="Loading…" />}
      {!settings.loading && !settings.loadError && (
        <Card>
          <ChannelsStep api={settings} autoSave />
        </Card>
      )}

      <SectionTitle>Recorded channels</SectionTitle>
      {error && <EmptyState text={error} />}
      {!error && !data && <EmptyState text="Loading…" />}
      {!error && data && (
        <div className="flex flex-col gap-4">
          {data.items.length === 0 && (
            <Card>
              <EmptyState text="No channels recorded yet. The first message received through a connected channel sets the principal channel." />
            </Card>
          )}
          {data.items.length > 0 && (
            <Card>
              <PanelLabel>Recorded channels ({data.items.length})</PanelLabel>
              <div className="flex flex-col gap-2">
                {data.items.map((c) => (
                  <div
                    key={c.id}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-panel border px-4 py-3',
                      c.isPrincipal ? 'border-accent-muted bg-accent-muted' : 'border-subtle bg-bg-3',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-body font-medium text-accent-2">{c.channel}</span>
                        {c.isPrincipal && <Badge tone="accent">principal</Badge>}
                      </div>
                      <div className="mt-1 truncate font-mono text-mini text-txt-2">{c.target}</div>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-2">
                      <div className="font-mono text-micro text-txt-3">{formatDate(c.createdAt)}</div>
                      {!c.isPrincipal && (
                        <Button size="sm" onClick={() => setPrincipal(c.id)}>
                          Set principal
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {principal && (
            <Card>
              <PanelLabel>Principal channel</PanelLabel>
              <p className="text-body text-txt-2">
                Heartbeat results are delivered to{' '}
                <span className="font-mono text-accent-2">
                  {principal.channel} · {principal.target}
                </span>{' '}
                unless a beat specifies its own channel and target.
              </p>
            </Card>
          )}
        </div>
      )}

      <SectionTitle>Outbound messages</SectionTitle>
      <Card>
        <PanelLabel>Start a message</PanelLabel>
        <form onSubmit={sendMessage} className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <Field label="Channel" className="sm:w-48">
              {({ id }) => (
                <Select id={id} value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="">Any channel</option>
                  {settings.channels.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Recipient" className="flex-1">
              {({ id }) => (
                <Input
                  id={id}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="chat id / jid"
                  className="font-mono"
                />
              )}
            </Field>
          </div>
          <Field label="Message" hint="Provide a channel and the recipient identifier used by that channel.">
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                required
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Message content"
                rows={3}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={sending} className="w-full self-start sm:w-auto">
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </form>
      </Card>

      <div className="mt-4">
        {outboundError && <EmptyState text={outboundError} />}
        {!outboundError && !outbound && <EmptyState text="Loading…" />}
        {!outboundError && outbound && outbound.items.length === 0 && (
          <Card>
            <EmptyState text="No outbound messages yet." />
          </Card>
        )}
        {!outboundError && outbound && outbound.items.length > 0 && (
          <Card className="flex flex-col gap-2">
            {outbound.items.map((m) => (
              <div key={m.id} className="rounded-panel border border-subtle bg-bg-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={m.status === 'sent' ? 'success' : 'danger'} dot>{m.status}</Badge>
                    <span className="font-mono text-mini text-accent-2">{m.channel}</span>
                    <span className="font-mono text-mini text-txt-2">{m.target}</span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-body text-txt">{m.content}</div>
                  {m.status === 'failed' && m.errorMessage && (
                    <div className="mt-2 font-mono text-mini text-danger-2">{m.errorMessage}</div>
                  )}
                  <div className="mt-2 font-mono text-micro text-txt-3">
                    Created: {formatDate(m.createdAt)}
                    {m.sentAt ? ` · Sent: ${formatDate(m.sentAt)}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
      <Toast message={toastMsg} isError={isError} />
    </SettingsSection>
  );
}
