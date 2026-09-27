import { config } from '../config';
import { type Request, type Response, type NextFunction } from 'express';

/**
 * Returns an Express middleware that requires a matching `Authorization: Bearer <token>`
 * header when `config.ADMIN_SECRET` is non-empty. When no secret is configured
 * (the default), the middleware is a no-op so existing deployments are unaffected.
 */
export function requireAdminSecret() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const secret = config.ADMIN_SECRET;
    if (!secret) {
      // Opt-in: no secret configured → open access (backwards-compatible default)
      next();
      return;
    }
    const auth = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== secret) {
      res.status(401).json({ error: 'Unauthorized. Provide a valid Authorization: Bearer <admin_secret> header.' });
      return;
    }
    next();
  };
}
