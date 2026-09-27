import { EmptyState } from '../../components/AdminUI';
import { SaveStatus, SettingsGroup, SettingsSection } from '../../components/SettingsUI';
import { Field, Input } from '../../components/ui';
import { cn } from '../../lib/cn';
import { postSettings, useAutoSave, useConfigSnapshot } from '../../lib/config-save-context';
import type { RuntimeSettings } from '../../lib/use-settings-form';
import type { SkillsMode } from '../../lib/types';

const MODES: { value: SkillsMode; label: string; description: string }[] = [
  { value: 'auto', label: 'Automatic', description: 'Include enabled skills with every message.' },
  { value: 'manual', label: 'On demand', description: 'Load a skill for one turn with /<skill-name>.' },
];

function SkillsForm({ settings }: { settings: RuntimeSettings }) {
  const mode = useAutoSave<SkillsMode>('skills.mode', settings.SKILLS?.MODE ?? 'auto', async (value) => { await postSettings({ skills: { mode: value } }); });
  const limit = useAutoSave('skills.limit', String(settings.SKILLS?.LIMIT ?? 10), async (value) => { await postSettings({ skills: { limit: Number(value) } }); }, (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? null : 'Enter a whole number greater than zero.');

  return (
    <div className="flex flex-col gap-4">
      <SettingsGroup title="How skills are loaded" description="Choose when your assistant receives skill instructions.">
        <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Skill ingestion mode">
          {MODES.map(({ value, label, description }) => {
            const selected = mode.value === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => mode.update(value, true)}
                className={cn(
                  'rounded-panel border p-4 text-left transition-colors',
                  'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  selected ? 'border-accent bg-accent-muted' : 'border-subtle bg-bg-3/40 hover:border-strong hover:bg-bg-3',
                )}
              >
                <span className="flex items-center justify-between gap-2 text-lead font-semibold text-txt">
                  {label}
                  <span aria-hidden="true" className={cn('text-body', selected ? 'text-accent-2' : 'text-txt-3')}>
                    {selected ? '●' : '○'}
                  </span>
                </span>
                <span className="mt-2 block text-caption leading-relaxed text-txt-2">{description}</span>
              </button>
            );
          })}
        </div>
        <SaveStatus {...mode} />
      </SettingsGroup>

      {mode.value === 'auto' && (
        <SettingsGroup title="Skill limit" description="The maximum number of skills included with each message.">
          <Field label="Skills per turn">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={1}
                step={1}
                value={limit.value}
                onChange={(event) => limit.update(event.target.value)}
                className="max-w-32"
                invalid={limit.state === 'invalid'}
              />
            )}
          </Field>
          <SaveStatus {...limit} />
        </SettingsGroup>
      )}

      <p className="text-caption text-txt-2">Manage individual skills in Configuration → Plugins.</p>
    </div>
  );
}

export default function SkillsSettingsPage() {
  const { settings, error } = useConfigSnapshot();
  return (
    <SettingsSection title="Skills" description="Give your assistant the right knowledge at the right time.">
      {error ? <EmptyState text={error} /> : settings ? <SkillsForm settings={settings} /> : <EmptyState text="Loading settings…" />}
    </SettingsSection>
  );
}
