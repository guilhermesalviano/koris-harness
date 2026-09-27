import type { SettingsFormApi } from '../../../lib/use-settings-form';
import type { UsePluginsApi } from '../../../lib/use-plugins';

function formatName(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-subtle py-2.5 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="text-caption text-txt-2">{label}</dt>
      <dd
        className={`break-all text-body text-txt sm:break-normal sm:text-right ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

export function ReviewStep({ api, pluginsApi }: { api: SettingsFormApi; pluginsApi?: UsePluginsApi }) {
  const { form } = api;
  const workers = form.sameForBoth ? form.manager : form.workers;

  const activeChannels = pluginsApi
    ? pluginsApi.items.filter((i) => i.family === 'channels' && i.enabled).map((i) => formatName(i.name))
    : [];

  return (
    <div>
      <dl className="rounded-panel border border-subtle bg-bg-3/50 px-4 py-1">
        <Row label="Manager provider" value={`${form.manager.provider} · ${form.manager.model || '—'}`} mono />
        <Row label="Worker provider" value={`${workers.provider} · ${workers.model || '—'}`} mono />
        <Row label="Active channels" value={activeChannels.length > 0 ? activeChannels.join(', ') : 'none'} mono />
        <Row
          label="Personal info fields"
          value={String(Object.keys(form.personal_information).length || 'none')}
        />
      </dl>

      {api.saveErrors && (
        <div
          role="alert"
          className="mt-4 rounded-panel border border-danger bg-danger-muted px-4 py-3 text-caption text-danger"
        >
          {api.saveErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
