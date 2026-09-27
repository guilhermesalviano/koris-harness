import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge needs to know about the custom scales declared in
 * `index.css`'s `@theme` block, otherwise it misfiles them — `text-body`
 * would be read as a text *colour* and silently dropped when merged
 * against `text-txt-2`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        'bg', 'bg-2', 'bg-3', 'bg-4',
        'accent', 'accent-2', 'accent-muted',
        'txt', 'txt-2', 'txt-3',
        'success', 'success-2', 'success-muted',
        'danger', 'danger-2', 'danger-muted',
        'warn', 'warn-2', 'warn-muted',
        'info', 'info-2', 'info-muted',
      ],
      text: ['micro', 'mini', 'caption', 'body', 'lead', 'title', 'display', 'hero'],
      radius: ['control', 'panel', 'card'],
      shadow: ['panel', 'pop'],
    },
  },
});

/** Compose class names, with later Tailwind utilities winning over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
