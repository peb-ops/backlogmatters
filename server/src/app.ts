import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { BUILD_HEADER, BUILD_ID } from '../../shared/build';
import { HttpError, loadUser, requireAppHeader } from './auth';
import { authRoutes, backupRoute } from './routes/auth';
import { projectRoutes } from './routes/projects';
import type { Store } from './store';

export interface AppOptions {
  /** Folder holding the built web client. Omit to serve the API only. */
  clientDir?: string;
  /** Set when running behind a reverse proxy that terminates HTTPS. */
  trustProxy?: boolean;
  /**
   * Feature flag for sign-in, user management and the administration page. When false the
   * app is single-user: no sign-in, and everything runs as the built-in local user.
   */
  accounts?: boolean;
}

export function createApp(store: Store, options: AppOptions = {}) {
  const accounts = options.accounts ?? true;
  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy) app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // Without sign-in the only protection is that requests come from this PC. Checking the Host
  // header stops a malicious website from reaching the app by pointing its own domain at 127.0.0.1.
  if (!accounts) {
    app.use((req, _res, next) => {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      next(['localhost', '127.0.0.1', '[::1]'].includes(host) ? undefined : new HttpError(403, 'Request blocked'));
    });
  }

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader(BUILD_HEADER, BUILD_ID);
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(requireAppHeader);
  api.use(express.json({ limit: '10mb' }));
  api.use(loadUser(store, accounts));
  authRoutes(api, store, accounts);
  backupRoute(api, store, accounts);
  projectRoutes(api, store, accounts);
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  const clientDir = options.clientDir;
  if (clientDir && fs.existsSync(path.join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue.path.join('.');
      return void res.status(400).json({ error: field ? `${field}: ${issue.message}` : issue.message });
    }
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large')
      return void res.status(err.status).json({ error: 'The request could not be read' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  };
  app.use(onError);

  return app;
}
