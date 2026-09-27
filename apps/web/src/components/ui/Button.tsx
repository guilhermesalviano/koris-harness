import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-accent text-white hover:bg-accent-2 active:bg-accent shadow-panel',
  secondary:
    'border-strong bg-bg-3 text-txt-2 hover:border-accent-muted hover:bg-bg-4 hover:text-txt',
  ghost:
    'border-transparent bg-transparent text-txt-2 hover:bg-bg-3 hover:text-txt',
  danger:
    'border-danger bg-danger-muted text-danger-2 hover:bg-danger hover:text-white',
  subtle:
    'border-accent-muted bg-accent-muted text-accent-2 hover:bg-accent hover:text-white',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-mini',
  md: 'h-9 gap-2 px-3.5 text-caption',
  lg: 'h-11 gap-2 px-5 text-body',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a spinner and blocks interaction. */
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  iconLeft,
  iconRight,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center rounded-control border font-medium',
        'transition-colors duration-150 outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-0',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : iconLeft}
      {children}
      {loading ? null : iconRight}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" className="fill-none stroke-current opacity-25" strokeWidth={3} />
      <path d="M21 12a9 9 0 0 0-9-9" className="fill-none stroke-current" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

/** Square button for a bare icon. Requires an accessible label. */
export interface IconButtonProps extends Omit<ButtonProps, 'iconLeft' | 'iconRight' | 'size'> {
  'aria-label': string;
  size?: ButtonSize;
}

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
};

export function IconButton({ size = 'md', className, variant = 'ghost', ...rest }: IconButtonProps) {
  return <Button variant={variant} size={size} className={cn('px-0', ICON_SIZES[size], className)} {...rest} />;
}
