import { formatConnectionTestResult, type SettingsFormApi } from '../../../lib/use-settings-form';
import { Button, Field, Input, Select } from '../../../components/ui';

function ProfileFields({
  api,
  role,
  disabled,
}: {
  api: SettingsFormApi;
  role: 'manager' | 'workers';
  disabled: boolean;
}) {
  const profile = api.form[role];
  const result = api.connectionResults[role];
  const testing = api.testingConnection[role];
  const original = role === 'manager' ? api.original?.AI?.MANAGER : api.original?.AI?.WORKERS;

  function patch(field: keyof typeof profile, value: string) {
    api.update((prev) => ({ ...prev, [role]: { ...prev[role], [field]: value } }));
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Provider">
        {({ id }) => (
          <Select id={id} disabled={disabled} value={profile.provider} onChange={(e) => patch('provider', e.target.value)}>
            {api.providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Base URL">
        {({ id }) => (
          <Input
            id={id}
            disabled={disabled}
            value={profile.base_url}
            onChange={(e) => patch('base_url', e.target.value)}
            className="font-mono"
            placeholder="leave blank to use the provider default"
          />
        )}
      </Field>

      <Field label="Model">
        {({ id }) => (
          <Input
            id={id}
            disabled={disabled}
            value={profile.model}
            onChange={(e) => patch('model', e.target.value)}
            className="font-mono"
            placeholder="gemma4:e4b"
          />
        )}
      </Field>

      <Field label="API token">
        {({ id }) => (
          <Input
            id={id}
            disabled={disabled}
            type="password"
            value={profile.api_token}
            onChange={(e) => patch('api_token', e.target.value)}
            className="font-mono"
            placeholder={
              original?.API_TOKEN?.includes('••••')
                ? 'Leave blank to keep current token'
                : 'Only required by some providers'
            }
          />
        )}
      </Field>

      <Field label="Context size" hint="Tokens the model can consider at once.">
        {({ id }) => (
          <Input
            id={id}
            disabled={disabled}
            value={profile.num_ctx}
            inputMode="numeric"
            onChange={(e) => patch('num_ctx', e.target.value.replace(/[^\d]/g, ''))}
            className="font-mono"
            placeholder={String(original?.NUM_CTX ?? 16384)}
          />
        )}
      </Field>

      <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:gap-3">
        <Button
          disabled={disabled}
          loading={testing}
          onClick={() => api.testProviderConnection(role)}
          className="w-full sm:w-auto"
        >
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        {result && (
          <span
            role="status"
            className={`min-w-0 break-words font-mono text-mini ${result.ok ? 'text-success' : 'text-danger-2'}`}
          >
            {formatConnectionTestResult(result)}
          </span>
        )}
      </div>
    </div>
  );
}

export function ProviderStep({ api }: { api: SettingsFormApi }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-body font-semibold text-txt">Manager model</h3>
        <p className="mt-1 text-caption text-txt-2">Handles conversation and decides what to do.</p>
      </div>
      <ProfileFields api={api} role="manager" disabled={false} />

      <label className="flex cursor-pointer items-start gap-2.5 border-t border-subtle pt-5 text-body">
        <input
          type="checkbox"
          checked={api.form.sameForBoth}
          onChange={(e) => api.update((prev) => ({ ...prev, sameForBoth: e.target.checked }))}
          className="mt-1 accent-[var(--color-accent)]"
        />
        <span>Use the same provider for worker/background tasks</span>
      </label>

      {!api.form.sameForBoth && (
        <>
          <div>
            <h3 className="text-body font-semibold text-txt">Worker model</h3>
            <p className="mt-1 text-caption text-txt-2">Handles background tasks like summarization.</p>
          </div>
          <ProfileFields api={api} role="workers" disabled={false} />
        </>
      )}
    </div>
  );
}
