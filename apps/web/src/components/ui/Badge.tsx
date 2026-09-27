import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warn' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-subtle bg-bg-3 text-txt-2',
  accent: 'border-accent-muted bg-accent-muted text-accent-2',
  success: 'border-success bg-success-muted text-success',
  danger: 'border-danger bg-danger-muted text-danger',
  warn: 'border-warn bg-warn-muted text-warn',
  info: 'border-info bg-info-muted text-info',
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** Shows a small leading status dot. */
  dot?: boolean;
  mono?: boolean;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', dot = false, mono = true, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-micro',
        mono && 'font-mono',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
