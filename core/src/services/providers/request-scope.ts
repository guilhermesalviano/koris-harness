interface RequestScopeOptions {
  signal?: AbortSignal;
  hardTimeoutMs: number;
  idleTimeoutMs?: number;
}

/** Owns request cancellation, timeouts, and their cleanup for every provider. */
export function createRequestScope({ signal, hardTimeoutMs, idleTimeoutMs }: RequestScopeOptions) {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const onAbort = (): void => controller.abort(signal?.reason);
  const hardTimer = signal?.aborted
    ? undefined
    : setTimeout(() => controller.abort(), hardTimeoutMs);

  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  return {
    controller,
    bumpIdle: (): void => {
      clearTimeout(idleTimer);
      if (!disposed && !controller.signal.aborted && idleTimeoutMs !== undefined) {
        idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
      }
    },
    cleanup: (): void => {
      disposed = true;
      clearTimeout(hardTimer);
      clearTimeout(idleTimer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}
