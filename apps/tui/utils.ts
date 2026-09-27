import type { TuiCommandResult } from './types';

export function emitTerminalBell(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x07');
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; message?: string };
  return e.name === 'AbortError' || e.message === 'This operation was aborted';
}

export function normalizeCommandResult(
  result: TuiCommandResult | string | void,
): TuiCommandResult | undefined {
  if (typeof result === 'string') {
    return { response: result, action: 'none', handled: true };
  }
  if (!result) return undefined;
  return result;
}
