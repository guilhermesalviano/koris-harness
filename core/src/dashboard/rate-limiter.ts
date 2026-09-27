import { type Request, type Response, type NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * Creates a simple in-memory, per-IP sliding-window rate limiter middleware.
 * Note: for a single-process server this is sufficient. For multi-process
 * deployments (load-balanced), a shared store (Redis) would be needed.
 */
export function createRateLimiter(windowMs: number, maxRequests: number, errorMessage?: string) {
  const store = new Map<string, RateLimitEntry>();

  const pruneExpired = (now: number): void => {
    if (store.size <= 5_000) return;
    for (const [ip, entry] of store.entries()) {
      if (now - entry.windowStart >= windowMs) {
        store.delete(ip);
      }
    }
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    pruneExpired(now);

    const existing = store.get(ip);
    if (!existing || now - existing.windowStart >= windowMs) {
      store.set(ip, { count: 1, windowStart: now });
      next();
      return;
    }

    if (existing.count >= maxRequests) {
      res.status(429).json({
        error: errorMessage ?? 'Too many requests. Please slow down.',
      });
      return;
    }

    existing.count += 1;
    next();
  };
}
