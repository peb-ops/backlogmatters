import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createApp } from './app';
import { hashPassword } from './auth';
import { openDb } from './db';
import { Store } from './store';

// Local use binds to this PC only. For a company-wide service set BM_HOST=0.0.0.0
// (see README) and put the server behind HTTPS.
const config = {
  host: process.env.BM_HOST ?? '127.0.0.1',
  port: Number(process.env.BM_PORT ?? 4780),
  dataDir: path.resolve(process.env.BM_DATA_DIR ?? 'data'),
  clientDir: path.resolve(process.env.BM_CLIENT_DIR ?? path.join(path.dirname(process.argv[1]), 'client')),
  trustProxy: process.env.BM_TRUST_PROXY === '1',
  // Feature flag: sign-in, user management and the administration page. Off unless BM_ACCOUNTS=1.
  accounts: process.env.BM_ACCOUNTS === '1',
  openBrowser: process.env.BM_OPEN_BROWSER === '1',
};

function openBrowser(url: string): void {
  if (!config.openBrowser || process.platform !== 'win32') return;
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
}

async function resetAdmin(store: Store): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));
  try {
    const admins = store.listUsers().filter((u) => u.role === 'admin');
    if (!admins.length) {
      console.log('There is no administrator account yet. Start BacklogMatters and complete the setup screen.');
      return;
    }
    console.log(`Administrator accounts: ${admins.map((u) => u.username).join(', ')}`);
    const name = admins.length === 1 ? admins[0].username : (await ask('Username to reset: ')).trim();
    const user = admins.find((u) => u.username.toLowerCase() === name.toLowerCase());
    if (!user) {
      console.log('No administrator has that username. Nothing was changed.');
      return;
    }
    const password = await ask(`New password for ${user.username} (at least 8 characters): `);
    if (password.length < 8) {
      console.log('That password is too short. Nothing was changed.');
      return;
    }
    store.setPassword(user.id, hashPassword(password));
    store.updateUser(user.id, { disabled: false });
    store.deleteUserSessions(user.id);
    console.log(`Password updated. Sign in as ${user.username} with the new password.`);
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(openDb(path.join(config.dataDir, 'backlogmatters.db')));

  if (process.argv.includes('--reset-admin')) {
    await resetAdmin(store);
    return;
  }

  // Without sign-in, anyone who can reach the port has full access, so only this PC may connect.
  if (!config.accounts && !['127.0.0.1', '::1', 'localhost'].includes(config.host)) {
    console.error(`Refusing to start: BM_HOST is ${config.host} but sign-in is switched off.`);
    console.error('Set BM_ACCOUNTS=1 to turn sign-in on before making BacklogMatters reachable from other computers.');
    process.exit(1);
  }

  store.purgeExpiredSessions();
  const url = `http://localhost:${config.port}`;
  const server = createApp(store, config).listen(config.port, config.host, () => {
    console.log(`BacklogMatters is running at ${url}`);
    console.log(`Data is stored in ${config.dataDir}`);
    console.log(config.accounts ? 'Sign-in is on.' : 'Sign-in is off (single-user). Set BM_ACCOUNTS=1 to turn on sign-in and administration.');
    openBrowser(url);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${config.port} is already in use. BacklogMatters may already be running at ${url}`);
      openBrowser(url);
      process.exit(0);
    }
    throw err;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
