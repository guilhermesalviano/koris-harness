import { describe, expect, it, vi, beforeEach } from 'vitest';
import { requireAdminSecret } from '@/dashboard/auth-middleware';
import { config } from '@/config';
import type { Request, Response } from 'express';

describe('requireAdminSecret middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    req = { headers: {} };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  it('calls next() when no ADMIN_SECRET is configured', () => {
    const originalSecret = config.ADMIN_SECRET;
    (config as any).ADMIN_SECRET = '';

    try {
      const middleware = requireAdminSecret();
      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    } finally {
      (config as any).ADMIN_SECRET = originalSecret;
    }
  });

  it('rejects with 401 when token does not match ADMIN_SECRET', () => {
    const originalSecret = config.ADMIN_SECRET;
    (config as any).ADMIN_SECRET = 'super-secret-token';

    try {
      const middleware = requireAdminSecret();

      // No header
      middleware(req as Request, res as Response, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Unauthorized') }));
      expect(next).not.toHaveBeenCalled();

      // Malformed header
      req.headers = { authorization: 'Basic 12345' };
      middleware(req as Request, res as Response, next);
      expect(res.status).toHaveBeenCalledWith(401);

      // Wrong token
      req.headers = { authorization: 'Bearer wrong-token' };
      middleware(req as Request, res as Response, next);
      expect(res.status).toHaveBeenCalledWith(401);
    } finally {
      (config as any).ADMIN_SECRET = originalSecret;
    }
  });

  it('calls next() when valid Bearer token is provided', () => {
    const originalSecret = config.ADMIN_SECRET;
    (config as any).ADMIN_SECRET = 'valid-secret';

    try {
      const middleware = requireAdminSecret();
      req.headers = { authorization: 'Bearer valid-secret' };

      middleware(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    } finally {
      (config as any).ADMIN_SECRET = originalSecret;
    }
  });
});
