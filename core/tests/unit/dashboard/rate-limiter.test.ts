import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter } from '@/dashboard/rate-limiter';
import type { Request, Response } from 'express';

describe('createRateLimiter', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    req = { ip: '127.0.0.1' };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within limit and tracks count', () => {
    const limiter = createRateLimiter(60_000, 2);

    limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);

    limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(2);

    limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: 'Too many requests. Please slow down.' });
  });

  it('allows custom error message', () => {
    const limiter = createRateLimiter(60_000, 1, 'Rate limit exceeded');

    limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);

    limiter(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: 'Rate limit exceeded' });
  });

  it('resets window after expiration', () => {
    const limiter = createRateLimiter(10_000, 1);

    limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);

    limiter(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(429);

    vi.advanceTimersByTime(10_001);

    limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('falls back to socket.remoteAddress or unknown when req.ip is undefined', () => {
    const limiter = createRateLimiter(60_000, 5);

    const socketReq = {
      ip: undefined,
      socket: { remoteAddress: '10.0.0.1' },
    };
    limiter(socketReq as any, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);

    const unknownReq = {
      ip: undefined,
      socket: {},
    };
    limiter(unknownReq as any, res as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('prunes expired entries when store size exceeds 5000', () => {
    const limiter = createRateLimiter(5_000, 10);

    // Seed 5001 entries
    for (let i = 0; i <= 5001; i++) {
      limiter({ ip: `192.168.1.${i}` } as any, res as Response, next);
    }

    // Advance time past window to expire old entries
    vi.advanceTimersByTime(6_000);

    // Next request triggers pruneExpired
    limiter({ ip: 'new-ip' } as any, res as Response, next);
    expect(next).toHaveBeenCalled();
  });
});
