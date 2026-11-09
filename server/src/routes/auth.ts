import type { Response, Router } from 'express';
import { z } from 'zod';
import type { AuthState } from '../../../shared/types';
import {
  HttpError,
  checkLoginAllowed,
  endSession,
  hashPassword,
  recordLogin,
  requireAccounts,
  requireAdmin,
  requireUser,
  startSession,
  verifyPassword,
} from '../auth';
import type { Store } from '../store';

const username = z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores');
const displayName = z.string().trim().min(1).max(80);
const password = z.string().min(8, 'Use at least 8 characters').max(200);
const role = z.enum(['admin', 'manager', 'viewer']);

// Verified when the username is unknown, so response time does not reveal which usernames exist.
const DUMMY_HASH = hashPassword('not-a-real-password');

export function authRoutes(r: Router, store: Store, accounts: boolean): void {
  // Setup is needed until a real administrator exists; the built-in local user does not count.
  r.get('/auth/state', (req, res) => {
    const state: AuthState = { accounts, needsSetup: accounts && store.activeAdminCount() === 0, user: req.user ?? null };
    res.json(state);
  });

  r.use(['/auth/setup', '/auth/login', '/auth/logout', '/auth/password', '/users', '/admin'], requireAccounts(accounts));

  r.post('/auth/setup', (req, res) => {
    const data = z.object({ username, displayName, password }).parse(req.body);
    const user = store.transaction(() => {
      if (store.activeAdminCount() > 0) throw new HttpError(409, 'Setup has already been completed');
      return store.createUser({ username: data.username, displayName: data.displayName, passwordHash: hashPassword(data.password), role: 'admin' });
    });
    startSession(store, req, res, user.id, true);
    res.status(201).json(user);
  });

  r.post('/auth/login', (req, res) => {
    const data = z.object({ username: z.string().trim().max(40), password: z.string().max(200), remember: z.boolean().default(false) }).parse(req.body);
    checkLoginAllowed(data.username);
    const found = store.getCredentials(data.username);
    const ok = verifyPassword(data.password, found?.passwordHash ?? DUMMY_HASH) && !!found && !found.disabled;
    recordLogin(data.username, ok);
    if (!ok) throw new HttpError(401, 'Incorrect username or password');
    startSession(store, req, res, found!.id, data.remember);
    res.json(store.getUser(found!.id));
  });

  r.post('/auth/logout', (req, res) => {
    endSession(store, req, res);
    res.status(204).end();
  });

  r.post('/auth/password', requireUser, (req, res) => {
    const data = z.object({ current: z.string().max(200), next: password }).parse(req.body);
    const user = req.user!;
    if (!verifyPassword(data.current, store.getPasswordHash(user.id) ?? DUMMY_HASH)) throw new HttpError(400, 'Your current password is incorrect');
    store.setPassword(user.id, hashPassword(data.next));
    store.deleteUserSessions(user.id);
    startSession(store, req, res, user.id, true);
    res.status(204).end();
  });

  r.get('/users', requireUser, (req, res) => {
    if (req.user!.role === 'viewer') throw new HttpError(403, 'You do not have permission to do that');
    res.json(store.listActiveUsers());
  });

  // ---- administration ----

  r.get('/admin/users', requireAdmin, (_req, res) => res.json(store.listUsers()));

  r.post('/admin/users', requireAdmin, (req, res) => {
    const data = z.object({ username, displayName, password, role }).parse(req.body);
    if (store.getCredentials(data.username)) throw new HttpError(409, 'That username is already taken');
    res.status(201).json(store.createUser({ username: data.username, displayName: data.displayName, passwordHash: hashPassword(data.password), role: data.role }));
  });

  r.patch('/admin/users/:id', requireAdmin, (req, res) => {
    const patch = z.object({ displayName, role, disabled: z.boolean() }).partial().parse(req.body);
    const id = Number(req.params.id);
    store.transaction(() => {
      if (!store.getUser(id)) throw new HttpError(404, 'User not found');
      store.updateUser(id, patch);
      if (store.activeAdminCount() === 0) throw new HttpError(400, 'At least one active administrator is required');
    });
    if (patch.disabled) store.deleteUserSessions(id);
    res.json(store.getUser(id));
  });

  r.post('/admin/users/:id/password', requireAdmin, (req, res) => {
    const data = z.object({ password }).parse(req.body);
    const id = Number(req.params.id);
    if (!store.getUser(id)) throw new HttpError(404, 'User not found');
    store.setPassword(id, hashPassword(data.password));
    store.deleteUserSessions(id);
    res.status(204).end();
  });

  r.get('/admin/backup', requireAdmin, (_req, res) => sendBackup(store, res));
}

/**
 * The whole database as one file. With accounts off the only user is the person at this PC, so anyone may
 * download it; with accounts on it holds everyone's data, so administrators only.
 */
export function backupRoute(r: Router, store: Store, accounts: boolean): void {
  r.get('/backup', requireUser, (req, res, next) => {
    if (accounts && req.user!.role !== 'admin') return next(new HttpError(403, 'Administrators only'));
    sendBackup(store, res);
  });
}

function sendBackup(store: Store, res: Response): void {
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="backlogmatters-backup-${date}.db"`);
  res.send(store.backup());
}
