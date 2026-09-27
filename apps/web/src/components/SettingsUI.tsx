import type { ReactNode } from 'react';
import type { SaveState } from '../lib/save-coordinator';
import { cn } from '../lib/cn';
import { Button, fieldBase } from './ui';

/**
 * Back-compat class recipes. Prefer the `Input`/`Button` primitives in
 * `components/ui` for new code — these remain so existing call sites keep
 * working and stay visually in sync with the primitives.
 */
export const settingsInput = cn(fieldBase, 'py-2.5');
export const settingsButton = cn(
  'inline-flex h-9 items-center justify-center rounded-control border border-strong bg-bg-3 px-3.5',
  'text-caption font-medium text-txt-2 transition-colors',
  'hover:border-accent-muted hover:bg-bg-4 hover:text-txt',
  'outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
  'disabled:pointer-events-none disabled:opacity-45',
);

export function SettingsSection({
  title,
  description,
  children,
  onRefresh,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onRefresh?: () => void;
}) {
  return (
    <>
      <header className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-subtle px-5 py-5 sm:px-7">
        <div>
          <h2 className="text-title font-semibold">{title}</h2>
          {description && <p className="mt-1.5 max-w-prose text-caption leading-relaxed text-txt-2">{description}</p>}
        </div>
        {onRefresh && (
          <Button size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">{children}</div>
    </>
  );
}

export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-panel border border-subtle bg-bg-2 p-4 sm:p-5">
      <h3 className="text-body font-semibold text-txt">{title}</h3>
      {description && <p className="mt-1 max-w-prose text-mini leading-relaxed text-txt-2">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SaveStatus({ state, error, retry }: { state: SaveState; error: string | null; retry: () => void }) {
  const failed = state === 'error' || state === 'invalid';
  return (
    <div
      aria-live="polite"
      className={cn(
        'mt-2 flex min-h-4 flex-wrap items-center gap-2 text-mini',
        failed ? 'text-danger-2' : 'text-txt-2',
      )}
    >
      {state === 'pending' || state === 'saving' ? (
        'Saving…'
      ) : state === 'saved' ? (
        <>
          <span className="text-success" aria-hidden="true">✓</span> Saved
        </>
      ) : failed ? (
        error
      ) : null}
      {state === 'error' && (
        <button type="button" onClick={retry} className="font-medium underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}
