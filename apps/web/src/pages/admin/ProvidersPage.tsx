import { useState } from 'react';
import { EmptyState, Toggle } from '../../components/AdminUI';
import { SaveStatus, SettingsGroup, SettingsSection } from '../../components/SettingsUI';
import { Button, Field, Input, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useAutoSave, useSaveCoordinator, useSaveStates } from '../../lib/config-save-context';
import { useProviders } from '../../lib/use-providers';
import { formatConnectionTestResult, type ConnectionTestResult } from '../../lib/use-settings-form';
import { buildProviderEditPatch, validateProviderDraft, type ProviderDraft, type ProviderEditRole as Role } from '../../lib/provider-draft';
import type { ProviderCatalogEntry } from '../../lib/types';

const ROLES: { key: Role; label: string; description: string }[] = [
  { key: 'manager', label: 'Manager', description: 'The model that leads your conversations and coordinates tools.' },
  { key: 'workers', label: 'Workers', description: 'The model used for background work, summaries, and scheduled tasks.' },
  { key: 'embed', label: 'Embeddings', description: 'Turn memories into vectors so your assistant can find relevant context.' },
];

function ProviderEditor({ role }: { role: Role }) {
  const api = useProviders();
  const embed = role === 'embed';
  const active = api.active[role];
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const initial: ProviderDraft = {
    provider: active.provider,
    model: active.model,
    apiToken: '',
    baseUrl: api.catalog.find((item) => item.name === active.provider)?.storedBaseUrl ?? active.baseUrl,
    numCtx: String(active.numCtx ?? api.defaultNumCtx),
    enabled: api.active.embed.enabled,
  };
  const draft = useAutoSave(`providers.${role}`, initial, async (value, baseline) => {
    const result = await api.patchSettings(buildProviderEditPatch(role, value, baseline));
    if (!result.ok) throw new Error(result.errors?.join(' ') ?? 'Could not update this provider.');
  }, (value) => validateProviderDraft(value, embed));
  const selected = api.catalog.find((item) => item.name === draft.value.provider);
  const choices = api.catalog.filter((item) => !embed || item.embeddings);
  const meta = ROLES.find((item) => item.key === role)!;

  function selectProvider(entry: ProviderCatalogEntry) {
    setTestResult(null);
    draft.update({
      provider: entry.name,
      model: embed ? (entry.name === api.active.embed.provider ? api.active.embed.model : '') : entry.model || entry.recommendedModel || '',
      baseUrl: entry.storedBaseUrl,
      apiToken: '',
      numCtx: String(entry.storedNumCtx ?? api.defaultNumCtx),
      enabled: true,
    }, true);
  }

  function edit(field: 'model' | 'apiToken' | 'baseUrl' | 'numCtx', value: string) {
    setTestResult(null);
    draft.update((previous) => ({ ...previous, [field]: value }));
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.test({ provider: draft.value.provider, baseUrl: draft.value.baseUrl || selected?.defaultBaseUrl || '', apiToken: draft.value.apiToken }));
    } finally { setTesting(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsGroup title={meta.label} description={meta.description}>
        {embed && (
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-subtle pb-4">
            <span className="text-body font-medium text-txt">Semantic memory</span>
            <Toggle checked={draft.value.enabled} disabled={!draft.value.provider} onChange={() => draft.update((value) => ({ ...value, enabled: !value.enabled }), true)} label="Enable semantic memory" />
          </div>
        )}

        <Field label="Provider" hint="Selecting a provider makes it active for this role.">
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={draft.value.provider}
              onChange={(event) => { const entry = choices.find((item) => item.name === event.target.value); if (entry) selectProvider(entry); }}
            >
              {!draft.value.provider && <option value="" disabled>Choose a provider</option>}
              {choices.map((item) => <option key={item.name} value={item.name}>{item.label}</option>)}
            </Select>
          )}
        </Field>

        {selected && (
          <div className="mt-6 flex flex-col gap-6 border-t border-subtle pt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={embed ? 'Embedding model' : 'Model'}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.value.model}
                    onChange={(event) => edit('model', event.target.value)}
                    className="font-mono"
                    placeholder={embed ? 'Embedding model name' : selected.recommendedModel || 'Model name'}
                    autoComplete="off"
                  />
                )}
              </Field>

              <Field label="API token">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="password"
                    value={draft.value.apiToken}
                    onChange={(event) => edit('apiToken', event.target.value)}
                    placeholder={selected.hasToken ? 'Stored securely · leave blank to keep' : 'Enter an API token if required'}
                    autoComplete="off"
                  />
                )}
              </Field>

              {!embed && (
                <Field label="Context size" hint="Maximum tokens per request. Blank keeps the saved value.">
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      type="number"
                      min={512}
                      max={131072}
                      step={1}
                      value={draft.value.numCtx}
                      onChange={(event) => edit('numCtx', event.target.value)}
                      placeholder={String(api.defaultNumCtx)}
                    />
                  )}
                </Field>
              )}

              <Field label="Base URL" hint="Optional override." className={embed ? 'sm:col-span-2' : undefined}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={draft.value.baseUrl}
                    onChange={(event) => edit('baseUrl', event.target.value)}
                    className="font-mono"
                    placeholder={selected.defaultBaseUrl || 'http://localhost:11434'}
                    autoComplete="off"
                  />
                )}
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Button disabled={draft.state === 'invalid'} loading={testing} onClick={test}>
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
              {selected.apiKeyUrl && <a href={selected.apiKeyUrl} target="_blank" rel="noreferrer" className="text-caption text-accent-2 hover:underline">Get API key ↗</a>}
              {selected.docsUrl && <a href={selected.docsUrl} target="_blank" rel="noreferrer" className="text-caption text-accent-2 hover:underline">Browse models ↗</a>}
            </div>

            {testResult && (
              <p aria-live="polite" className={cn('text-caption', testResult.ok ? 'text-success' : 'text-danger-2')}>
                {formatConnectionTestResult(testResult)}
              </p>
            )}
          </div>
        )}
        <SaveStatus {...draft} />
      </SettingsGroup>

      {!embed && api.active.manager.provider === api.active.workers.provider && draft.value.provider === api.active.manager.provider && (
        <p className="text-caption leading-relaxed text-txt-2">Manager and Workers share this provider. Model, credentials, and context size apply to both roles.</p>
      )}
    </div>
  );
}

export default function ProvidersPage() {
  const api = useProviders();
  const saves = useSaveCoordinator();
  const states = useSaveStates();
  const [role, setRole] = useState<Role>('manager');

  return (
    <SettingsSection title="Providers" description="Choose the intelligence behind your assistant.">
      {api.error && <EmptyState text={api.error} />}
      {api.loading ? <EmptyState text="Loading providers…" /> : (
        <div className="flex flex-col gap-6">
          <div className="inline-flex max-w-full gap-0.5 self-start rounded-control border border-subtle bg-bg-2 p-0.5" role="group" aria-label="Provider role">
            {ROLES.map((item) => {
              const selected = role === item.key;
              const needsAttention = states.some((state) => state.key === `providers.${item.key}` && (state.state === 'invalid' || state.state === 'error'));
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-label={item.label}
                  aria-pressed={selected}
                  onClick={() => { void saves.flush('providers.'); setRole(item.key); }}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-[7px] px-3 py-1.5 text-caption font-medium transition-colors sm:px-4',
                    'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    selected ? 'bg-accent-muted text-accent-2' : 'text-txt-2 hover:bg-bg-3 hover:text-txt',
                  )}
                >
                  {item.label}
                  {needsAttention && <span aria-label="Changes need attention" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-danger" />}
                </button>
              );
            })}
          </div>
          <ProviderEditor key={role} role={role} />
        </div>
      )}
    </SettingsSection>
  );
}
