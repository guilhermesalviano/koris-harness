import type { Request } from 'express';

/** Parse a single finite integer and clamp it to the endpoint's bounds. */
export function queryInteger(value: unknown, fallback: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

export function parsePagination(req: Request): { limit: number; offset: number } {
  return {
    limit: queryInteger(req.query.limit, 20, 1, 200),
    offset: queryInteger(req.query.offset, 0, 0),
  };
}
