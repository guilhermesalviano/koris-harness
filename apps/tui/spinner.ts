import * as readline from 'readline';

import { defaultColors, type TuiColors } from './colors';
import type { SpinnerOptions } from './types';

export function startSpinner(
  spinnerOptions: SpinnerOptions | undefined,
  enabled: boolean,
  colors: TuiColors = defaultColors,
  hooks?: {
    onFrame(text: string): void;
    onStop(): void;
  }
): () => void {
  if (!enabled) return () => undefined;
  if (spinnerOptions?.enabled === false) return () => undefined;

  const frames = spinnerOptions?.frames ?? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const label = spinnerOptions?.label ?? 'Thinking';
  const intervalMs = spinnerOptions?.intervalMs ?? 80;

  let index = 0;
  const interval = setInterval(() => {
    const text = `${frames[index]} ${label}...  Press 'Esc' to cancel`;
    const coloredText = `${colors.bright}${colors.gray}${text}${colors.reset}`;
    if (hooks) {
      hooks.onFrame(coloredText);
    } else {
      process.stdout.write(`\r${coloredText}`);
    }

    index = (index + 1) % frames.length;
  }, intervalMs);

  return () => {
    clearInterval(interval);
    if (hooks) {
      hooks.onStop();
      return;
    }

    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  };
}