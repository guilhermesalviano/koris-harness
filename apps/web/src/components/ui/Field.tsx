import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface FieldProps {
  label: string;
  /** Helper copy shown under the label. */
  hint?: string;
  /** When set, the field renders in its error state and announces the message. */
  error?: string | null;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
  className?: string;
  /** Receives the id to wire onto the control. */
  children: (props: { id: string; invalid: boolean; describedBy?: string }) => ReactNode;
}

export function Field({ label, hint, error, hideLabel, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cn('text-caption font-medium text-txt', hideLabel && 'sr-only')}>
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-mini leading-relaxed text-txt-2">
          {hint}
        </p>
      )}
      {children({ id, invalid: Boolean(error), describedBy })}
      {error && (
        <p id={errorId} role="alert" className="text-mini text-danger-2">
          {error}
        </p>
      )}
    </div>
  );
}
