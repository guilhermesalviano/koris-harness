import type { ReactNode } from 'react';
import { EmptyState } from '../../components/AdminUI';
import { SaveStatus, SettingsGroup, SettingsSection } from '../../components/SettingsUI';
import { MoonIcon, SunIcon } from '../../components/Icons';
import { Button, Field, Input, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { postSettings, useAutoSave, useConfigSnapshot } from '../../lib/config-save-context';
import { useUi } from '../../lib/ui-context';
import type { RuntimeSettings } from '../../lib/use-settings-form';

type PersonalEntry = {
  id: string;
  key: string;
  value: string;
};

function ThemeChoice({
  active,
  onSelect,
  icon,
  label,
}: {
  active: boolean;
  onSelect: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Button
      size="lg"
      variant={active ? 'subtle' : 'secondary'}
      aria-pressed={active}
      onClick={onSelect}
      iconLeft={icon}
      className={cn('flex-1 rounded-panel text-body', active && 'border-accent')}
    >
      {label}
    </Button>
  );
}

function GeneralForm({ settings }: { settings: RuntimeSettings }) {
  const domains = useAutoSave('general.domains', (settings.ALLOWED_DOMAINS ?? []).join('\n'), async (text) => {
    await postSettings({ allowed_domains: text.split(/[\n,]/).map((value) => value.trim().toLowerCase()).filter(Boolean) });
  });
  const personal = useAutoSave<PersonalEntry[]>(
    'general.personal',
    Object.entries(settings.PERSONAL_INFORMATION ?? {}).map(([key, value]) => ({ id: key, key, value })),
    async (entries) => {
      await postSettings({ personal_information: Object.fromEntries(entries.filter((entry) => entry.key.trim()).map((entry) => [entry.key.trim(), entry.value])) });
    },
    (entries) => {
      const keys = entries.map((entry) => entry.key.trim());
      if (entries.some((entry) => !entry.key.trim() && entry.value.trim())) return 'Give each field a name.';
      if (new Set(keys.filter(Boolean)).size !== keys.filter(Boolean).length) return 'Use a different name for each field.';
      return null;
    },
  );

  const { isDark, toggleTheme } = useUi();

  return (
    <div className="flex flex-col gap-4">
      <SettingsGroup title="Appearance" description="Choose your preferred color scheme.">
        <div className="flex gap-3">
          <ThemeChoice
            active={!isDark}
            onSelect={() => { if (isDark) toggleTheme(); }}
            icon={<SunIcon className="h-4 w-4 flex-shrink-0 fill-none stroke-current" />}
            label="Light"
          />
          <ThemeChoice
            active={isDark}
            onSelect={() => { if (!isDark) toggleTheme(); }}
            icon={<MoonIcon className="h-4 w-4 flex-shrink-0 fill-none stroke-current" />}
            label="Dark"
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title="Allowed domains" description="Choose which websites your assistant can reach. Leave empty to deny outbound requests.">
        <Field label="Allowed domains" hint="One domain per line.">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={5}
              value={domains.value}
              onChange={(event) => domains.update(event.target.value)}
              placeholder={'example.com\napi.example.com'}
              className="font-mono"
            />
          )}
        </Field>
        <SaveStatus {...domains} />
      </SettingsGroup>

      <SettingsGroup title="Personal context" description="A few details to help your assistant give more relevant answers.">
        <div className="flex flex-col gap-3">
          {personal.value.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Field name"
                value={entry.key}
                placeholder="Name, location, preferences…"
                className="min-w-0 flex-1 basis-36"
                onChange={(event) => personal.update((entries) => entries.map((row) => row.id === entry.id ? { ...row, key: event.target.value } : row))}
              />
              <Input
                aria-label={`Value for ${entry.key || 'new field'}`}
                value={entry.value}
                placeholder="Your details"
                className="min-w-0 flex-1 basis-44"
                onChange={(event) => personal.update((entries) => entries.map((row) => row.id === entry.id ? { ...row, value: event.target.value } : row))}
              />
              <Button
                variant="ghost"
                aria-label={`Remove ${entry.key || 'field'}`}
                className="hover:bg-danger-muted hover:text-danger-2"
                onClick={() => personal.update((entries) => entries.filter((row) => row.id !== entry.id), true)}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            className="self-start"
            onClick={() => personal.update((entries) => [...entries, { id: crypto.randomUUID(), key: '', value: '' }])}
          >
            + Add field
          </Button>
        </div>
        <SaveStatus {...personal} />
      </SettingsGroup>
    </div>
  );
}

export default function GeneralPage() {
  const { settings, error } = useConfigSnapshot();
  return (
    <SettingsSection title="General" description="Make your assistant feel more like yours.">
      {error ? <EmptyState text={error} /> : settings ? <GeneralForm settings={settings} /> : <EmptyState text="Loading settings…" />}
    </SettingsSection>
  );
}
