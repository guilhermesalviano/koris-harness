interface CachedLoaderOptions<T> {
  load: () => Promise<T>;
  ttlMs: number;
  fallback: () => T;
}

/** Coalesces concurrent loads and retains the last successful value on failure. */
export function createCachedLoader<T>({ load, ttlMs, fallback }: CachedLoaderOptions<T>): () => Promise<T> {
  let cached: { expiresAt: number; value: T } | undefined;
  let pending: Promise<T> | undefined;

  return () => {
    if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.value);
    if (pending) return pending;

    pending = Promise.resolve().then(load)
      .then((value) => {
        cached = { value, expiresAt: Date.now() + ttlMs };
        return value;
      })
      .catch(() => cached ? cached.value : fallback())
      .finally(() => { pending = undefined; });
    return pending;
  };
}
