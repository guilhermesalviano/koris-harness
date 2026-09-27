import { useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Optional count/status shown after the label. */
  badge?: ReactNode;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the tab list. */
  label: string;
  /** Maps a value to the id of its tabpanel, for aria-controls. */
  panelId?: (value: T) => string;
  className?: string;
}

/**
 * Roving-tabindex tab strip. Arrow keys move between tabs, Home/End jump to
 * the ends — same keyboard contract as the config modal's section list.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  panelId,
  className,
}: SegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const current = options.findIndex((o) => o.value === value);
      if (current < 0) return;

      let next = current;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % options.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + options.length) % options.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = options.length - 1;
      else return;

      event.preventDefault();
      const option = options[next];
      if (!option) return;
      onChange(option.value);
      refs.current[next]?.focus();
    },
    [options, value, onChange],
  );

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('inline-flex items-center gap-0.5 rounded-control border border-subtle bg-bg-2 p-0.5', className)}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId?.(option.value)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-caption font-medium',
              'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              selected ? 'bg-accent-muted text-accent-2' : 'text-txt-2 hover:bg-bg-3 hover:text-txt',
            )}
          >
            {option.icon}
            {option.label}
            {option.badge}
          </button>
        );
      })}
    </div>
  );
}
