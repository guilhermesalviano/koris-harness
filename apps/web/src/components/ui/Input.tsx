import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** Shared field chrome. Kept in one place so inputs/selects/textareas can't drift. */
export const fieldBase = cn(
  'w-full rounded-control border border-strong bg-bg-3/60 px-3 text-body text-txt',
  'outline-none transition-colors placeholder:text-txt-3',
  'focus:border-accent focus:ring-2 focus:ring-accent/15',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

const invalidRing = 'border-danger focus:border-danger focus:ring-danger/20';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ className, invalid, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'h-9', invalid && invalidRing, className)}
      {...rest}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ className, invalid, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'resize-y py-2 leading-relaxed', invalid && invalidRing, className)}
      {...rest}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function Select({ className, invalid, children, ...rest }: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'h-9 cursor-pointer appearance-none pr-8', invalid && invalidRing, className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238888a0' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.6rem center',
        backgroundSize: '1rem',
      }}
      {...rest}
    >
      {children}
    </select>
  );
}
