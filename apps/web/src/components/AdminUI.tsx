import { useEffect, useState, type ReactNode } from 'react';
import { usePageTitle } from '../lib/use-page-title';
import { cn } from '../lib/cn';
import { Button } from './ui';

interface PageShellProps {
  title: string;
  description?: string;
  onRefresh?: () => void;
  /** Extra controls rendered in the header, before the refresh button. */
  actions?: ReactNode;
  children: ReactNode;
}

export function PageShell({ title, description, onRefresh, actions, children }: PageShellProps) {
  usePageTitle(title, description);

  return (
    <>
      <header className="sticky top-0 z-10 flex flex-shrink-0 items-center gap-3 border-b border-subtle bg-bg/80 px-6 py-3.5 backdrop-blur-md">
        <div className="min-w-0">
          <h1 className="text-lead font-semibold text-txt">{title}</h1>
          {description && <p className="mt-0.5 truncate font-mono text-mini text-txt-3">{description}</p>}
        </div>
        {(actions || onRefresh) && (
          <div className="ml-auto flex items-center gap-2">
            {actions}
            {onRefresh && (
              <Button size="sm" onClick={onRefresh}>
                Refresh
              </Button>
            )}
          </div>
        )}
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
    </>
  );
}

export function Card({
  children,
  className = '',
  /** Adds hover affordance for cards that act as buttons/links. */
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-card border border-subtle bg-bg-2 p-5',
        interactive && 'cursor-pointer transition-colors hover:border-strong hover:bg-bg-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="font-mono text-caption text-txt-3">{text}</p>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="font-mono text-micro uppercase text-txt-3">{label}</div>
      <div className="mt-2 text-display font-semibold text-txt tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-mini text-txt-2">{hint}</div>}
    </Card>
  );
}

export function formatDate(value?: string | number | Date | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

export function useToast(): [string | null, (msg: string, isError?: boolean) => void, boolean] {
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 2600);
    return () => clearTimeout(t);
  }, [message]);

  return [message, (msg: string, err = false) => { setMessage(msg); setIsError(err); }, isError];
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50',
        checked ? 'border-accent-muted bg-accent' : 'border-strong bg-bg-3',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-1',
        )}
      />
    </button>
  );
}

export function Toast({ message, isError }: { message: string | null; isError: boolean }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed bottom-6 left-1/2 z-[110] max-w-[calc(100vw-2rem)] -translate-x-1/2',
        'animate-[toastIn_0.2s_ease] break-words rounded-full border px-4 py-2 text-center',
        'font-mono text-caption shadow-pop',
        isError ? 'border-danger bg-danger-muted text-danger' : 'border-strong bg-bg-3 text-txt',
      )}
    >
      {message}
    </div>
  );
}
