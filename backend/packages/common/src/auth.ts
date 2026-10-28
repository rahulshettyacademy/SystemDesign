import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { ApiError } from './errors';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId: string;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ email: user.email, name: user.name, role: user.role }, config.jwtSecret, {
    subject: user.id,
    expiresIn: '8h',
    issuer: 'qamart-auth',
  });
}

/** Every service verifies the JWT itself; nobody trusts the caller just because it reached the network. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Missing Authorization: Bearer <token> header');
  }
  try {
    const p = jwt.verify(token, config.jwtSecret, { issuer: 'qamart-auth' }) as jwt.JwtPayload;
    req.user = { id: String(p.sub), email: p.email, name: p.name, role: p.role };
    next();
  } catch (e) {
    const expired = (e as Error).name === 'TokenExpiredError';
    throw new ApiError(401, expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID', expired ? 'Token has expired' : 'Token is invalid');
  }
}

export function requireRole(role: AuthUser['role']) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.user?.role !== role) throw new ApiError(403, 'FORBIDDEN', `This operation requires the ${role} role`);
    next();
  };
}

/** Internal (service-to-service) routes require a shared token. Nginx never routes /internal anyway. */
export function requireInternal(req: Request, _res: Response, next: NextFunction) {
  if (req.header('x-internal-token') !== config.internalToken) {
    throw new ApiError(403, 'INTERNAL_ONLY', 'This endpoint is only callable by other services');
  }
  next();
}
