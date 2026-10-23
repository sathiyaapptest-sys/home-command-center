import type { NextFunction, Request, Response } from 'express';
import type { OAuthStore } from './oauth/store.js';

/**
 * Amazon's docs say unauthenticated calls must get 401 *without* a
 * WWW-Authenticate header (not yet supported on their side), so this deliberately
 * does not use the SDK's requireBearerAuth, which adds one.
 */
export function requireBearer(store: OAuthStore) {
  return (req: Request, res: Response, next: NextFunction) => {
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match || !store.verifyAccess(match[1])) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}
