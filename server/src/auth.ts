import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { User } from '../../shared/types';
import type { Store } from './store';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const COOKIE = 'bm_session';
const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;
const LONG_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, 'hex'), expected.length), expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function sessionToken(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return undefined;
}

export function startSession(store: Store, req: Request, res: Response, userId: number, remember: boolean): void {
  const token = randomBytes(32).toString('base64url');
  const lifetime = remember ? LONG_SESSION_MS : SHORT_SESSION_MS;
  store.createSession(sha256(token), userId, new Date(Date.now() + lifetime).toISOString());
  const cookie = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (remember) cookie.push(`Max-Age=${Math.floor(lifetime / 1000)}`);
  if (req.secure) cookie.push('Secure');
  res.setHeader('Set-Cookie', cookie.join('; '));
}

export function endSession(store: Store, req: Request, res: Response): void {
  const token = sessionToken(req);
  if (token) store.deleteSession(sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** With accounts off there is no sign-in: every request runs as the built-in local user. */
export function loadUser(store: Store, accounts: boolean) {
  const local = accounts ? undefined : store.localUser();
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = sessionToken(req);
    if (local) req.user = local;
    else if (token) req.user = store.sessionUser(sha256(token));
    next();
  };
}

/** Switches off the routes that only make sense with accounts: sign-in, administration and sharing. */
export function requireAccounts(accounts: boolean) {
  return (_req: Request, _res: Response, next: NextFunction) =>
    next(accounts ? undefined : new HttpError(404, 'Accounts are switched off on this installation'));
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  next(req.user ? undefined : new HttpError(401, 'Please sign in'));
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  next(req.user?.role === 'admin' ? undefined : new HttpError(403, 'Administrators only'));
}

/** Browsers cannot add this header to a cross-site request without a CORS preflight, which we never grant. */
export function requireAppHeader(req: Request, _res: Response, next: NextFunction): void {
  const safe = req.method === 'GET' || req.method === 'HEAD';
  next(safe || req.get('X-Requested-With') === 'bm' ? undefined : new HttpError(403, 'Request blocked'));
}

const MAX_FAILURES = 5;
const LOCK_MS = 60_000;
const failures = new Map<string, { count: number; lockedUntil: number }>();

export function checkLoginAllowed(username: string): void {
  const entry = failures.get(username.toLowerCase());
  if (entry && entry.lockedUntil > Date.now()) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
}

export function recordLogin(username: string, ok: boolean): void {
  const key = username.toLowerCase();
  if (ok) return void failures.delete(key);
  if (failures.size > 10_000) failures.clear();
  const entry = failures.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= MAX_FAILURES) {
    entry.count = 0;
    entry.lockedUntil = Date.now() + LOCK_MS;
  }
  failures.set(key, entry);
}
