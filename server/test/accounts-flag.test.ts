import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthState, Project, User } from '../../shared/types';
import { createApp } from '../src/app';
import { openDb } from '../src/db';
import { Store } from '../src/store';

// One database served twice: once with the accounts flag off, once with it on.
const store = new Store(openDb(':memory:'));
const servers: Server[] = [];
let off: string;
let on: string;

async function serve(accounts: boolean): Promise<string> {
  const server = createApp(store, { accounts }).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}

async function call<T = any>(base: string, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bm', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
}

beforeAll(async () => {
  off = await serve(false);
  on = await serve(true);
});

afterAll(() => servers.forEach((s) => s.close()));

describe('accounts flag off', () => {
  it('needs no setup or sign-in and works as the local user', async () => {
    const state = (await call<AuthState>(off, 'GET', '/auth/state')).data;
    expect(state).toMatchObject({ accounts: false, needsSetup: false, user: { displayName: 'Local user' } });
    const made = await call<Project>(off, 'POST', '/projects', { name: 'Solo', key: 'SOLO' });
    expect(made.status).toBe(201);
    expect((await call(off, 'POST', `/projects/${made.data.id}/items`, { title: 'Works without signing in' })).status).toBe(201);
  });

  it('switches off sign-in, administration and sharing', async () => {
    const body = { username: 'someone', displayName: 'Someone', password: 'password1' };
    expect((await call(off, 'POST', '/auth/setup', body)).status).toBe(404);
    expect((await call(off, 'POST', '/auth/login', body)).status).toBe(404);
    expect((await call(off, 'GET', '/admin/users')).status).toBe(404);
    expect((await call(off, 'GET', '/admin/backup')).status).toBe(404);
    expect((await call(off, 'GET', '/users')).status).toBe(404);
    expect((await call(off, 'PUT', '/projects/1/members/1', { role: 'editor' })).status).toBe(404);
  });

  it('offers a backup download without signing in', async () => {
    const res = await fetch(off + '/backup');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="backlogmatters-backup-\d{4}-\d{2}-\d{2}\.db"/);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 15).toString()).toBe('SQLite format 3');
  });

  it('only answers requests addressed to this PC', async () => {
    // fetch does not allow overriding Host, so send the request by hand.
    const statusFor = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const url = new URL(off + '/projects');
        request({ host: url.hostname, port: url.port, path: url.pathname, headers: { Host: host } }, (res) => {
          res.resume();
          resolve(res.statusCode!);
        })
          .on('error', reject)
          .end();
      });
    expect(await statusFor('evil.example:4780')).toBe(403);
    expect(await statusFor('localhost:4780')).toBe(200);
    expect(await statusFor('127.0.0.1')).toBe(200);
  });
});

describe('turning the flag on later', () => {
  it('asks for an administrator, because the local user is not a real account', async () => {
    expect((await call<AuthState>(on, 'GET', '/auth/state')).data).toEqual({ accounts: true, needsSetup: true, user: null });
    expect((await call(on, 'GET', '/projects')).status).toBe(401);
    expect((await call(on, 'POST', '/auth/login', { username: 'local user', password: '!' })).status).toBe(401);
  });

  it('keeps the projects made while it was off and hides the local user from administration', async () => {
    const setup = await call<User>(on, 'POST', '/auth/setup', { username: 'boss', displayName: 'Boss', password: 'correct horse' });
    expect(setup.status).toBe(201);
    const asBoss = { Cookie: setup.cookie };
    const projects = (await call<Project[]>(on, 'GET', '/projects', undefined, asBoss)).data;
    expect(projects.map((p) => [p.name, p.ownerName, p.itemCount])).toEqual([['Solo', 'Local user', 1]]);
    expect((await call<User[]>(on, 'GET', '/admin/users', undefined, asBoss)).data.map((u) => u.username)).toEqual(['boss']);
    expect((await call(on, 'PATCH', `/projects/${projects[0].id}`, { ownerId: setup.data.id }, asBoss)).status).toBe(200);
  });

  it('keeps the backup download for administrators only', async () => {
    expect((await fetch(on + '/backup')).status).toBe(401);
    const boss = await call(on, 'POST', '/auth/login', { username: 'boss', password: 'correct horse' });
    await call(on, 'POST', '/admin/users', { username: 'max', displayName: 'Max', password: 'password1', role: 'manager' }, { Cookie: boss.cookie });
    const max = await call(on, 'POST', '/auth/login', { username: 'max', password: 'password1' });
    expect((await fetch(on + '/backup', { headers: { Cookie: max.cookie } })).status).toBe(403);
    expect((await fetch(on + '/backup', { headers: { Cookie: boss.cookie } })).status).toBe(200);
  });
});
