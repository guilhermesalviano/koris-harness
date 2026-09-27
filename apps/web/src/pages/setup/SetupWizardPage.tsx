import { useState, useEffect, useRef, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsForm, type SettingsFormApi } from '../../lib/use-settings-form';
import { usePlugins, type UsePluginsApi } from '../../lib/use-plugins';
import { useSaveCoordinator } from '../../lib/config-save-context';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui';
import { ProviderStep } from './steps/ProviderStep';
import { PluginsStep } from './steps/PluginsStep';
import { ChannelsStep } from './steps/ChannelsStep';
import { PersonalInfoStep } from './steps/PersonalInfoStep';
import { ReviewStep } from './steps/ReviewStep';

interface StepProps {
  api: SettingsFormApi;
  pluginsApi: UsePluginsApi;
}

function SetupChannelsStep({ api, pluginsApi }: StepProps) {
  return <ChannelsStep api={api} pluginsApi={pluginsApi} />;
}

const STEPS: { title: string; blurb: string; render: ComponentType<StepProps> }[] = [
  { title: 'AI provider', blurb: 'Pick the model that powers your assistant.', render: ProviderStep },
  { title: 'Plugins', blurb: 'Add tools and skills from the marketplace.', render: PluginsStep },
  { title: 'Channels', blurb: 'Choose where you want to talk to Koris.', render: SetupChannelsStep },
  { title: 'Personal info', blurb: 'Give the assistant some context about you.', render: PersonalInfoStep },
  { title: 'Review & save', blurb: 'Check everything over before finishing.', render: ReviewStep },
];

export default function SetupWizardPage() {
  const api = useSettingsForm();
  const saves = useSaveCoordinator();
  const pluginsApi = usePlugins();
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];
  const StepComponent = current.render;

  const initializedRef = useRef(false);
  useEffect(() => {
    if (!api.loading && !initializedRef.current) {
      initializedRef.current = true;
      api.update((prev) => ({ ...prev, sameForBoth: true }));
    }
  }, [api.loading, api.update]);

  async function handleNext() {
    await saves.flush('plugins.');
    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }
    const ok = await api.submit();
    if (ok) {
      navigate('/admin', { replace: true });
    }
  }

  if (api.loading || pluginsApi.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg font-mono text-caption text-txt-3">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-txt">
      <div className="relative z-1 mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-14">
        <header className="flex items-center gap-3">
          <img src="/logo.png" alt="" aria-hidden="true" className="h-9 w-9 flex-shrink-0" />
          <div>
            <h1 className="text-display font-semibold">Set up Koris Assistant</h1>
            <p className="mt-0.5 text-caption text-txt-2">
              Five quick steps. Everything here can be changed later.
            </p>
          </div>
        </header>

        <div className="mt-8">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-title font-semibold">{current.title}</h2>
            <span className="flex-shrink-0 font-mono text-mini text-txt-3">
              Step {step + 1} of {STEPS.length}
            </span>
          </div>
          <p className="mt-1 text-caption text-txt-2">{current.blurb}</p>

          <ol className="mt-4 flex gap-1.5" aria-label="Setup progress">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                aria-current={i === step ? 'step' : undefined}
                title={s.title}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  i < step && 'bg-accent/50',
                  i === step && 'bg-accent',
                  i > step && 'bg-bg-3',
                )}
              />
            ))}
          </ol>
        </div>

        <div className="mt-6 rounded-card border border-subtle bg-bg-2 p-4 shadow-panel sm:mt-8 sm:p-6">
          <StepComponent api={api} pluginsApi={pluginsApi} />
        </div>

        {api.loadError && (
          <p role="alert" className="mt-3 text-caption text-danger-2">
            {api.loadError}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <Button
            size="lg"
            disabled={step === 0}
            onClick={() => {
              void saves.flush('plugins.');
              setStep((s) => Math.max(0, s - 1));
            }}
          >
            Back
          </Button>
          <Button size="lg" variant="primary" loading={api.saving} onClick={handleNext}>
            {isLast ? (api.saving ? 'Saving…' : 'Save & finish') : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
