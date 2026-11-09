import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Board, ImportResult, Item, Project, User } from '../../shared/types';
import { createApp } from '../src/app';
import { openDb } from '../src/db';
import { Store } from '../src/store';

let server: Server;
let base: string;

/** One signed-in browser: remembers its session cookie between calls. */
function client() {
  let cookie = '';
  return async function call<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = { 'X-Requested-With': 'bm' }) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const textBody = await res.text();
    let data: any = textBody;
    try {
      data = JSON.parse(textBody);
    } catch {}
    return { status: res.status, data: data as T };
  };
}

const admin = client();
const manager = client();
const viewer = client();
const outsider = client();
let project: Project;
let items: Item[];

beforeAll(async () => {
  server = createApp(new Store(openDb(':memory:'))).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => server.close());

describe('setup and sign-in', () => {
  it('asks for setup on a fresh database and rejects unauthenticated use', async () => {
    expect((await admin('GET', '/auth/state')).data).toEqual({ accounts: true, needsSetup: true, user: null });
    expect((await admin('GET', '/projects')).status).toBe(401);
  });

  it('labels every API response, including errors, with the build it came from', async () => {
    for (const path of ['/auth/state', '/projects', '/nope']) {
      expect((await fetch(base + path)).headers.get('x-bm-build')).toBe('dev');
    }
  });

  it('creates the first administrator once', async () => {
    const first = await admin<User>('POST', '/auth/setup', { username: 'boss', displayName: 'The Boss', password: 'correct horse' });
    expect(first.status).toBe(201);
    expect(first.data.role).toBe('admin');
    expect((await outsider('POST', '/auth/setup', { username: 'evil', displayName: 'Evil', password: 'correct horse' })).status).toBe(409);
    expect((await admin('GET', '/auth/state')).data.user.username).toBe('boss');
  });

  it('blocks state-changing requests without the app header', async () => {
    expect((await admin('POST', '/projects', { name: 'X', key: 'XX' }, {})).status).toBe(403);
  });

  it('lets the administrator create users who can then sign in', async () => {
    for (const [username, role] of [['mia', 'manager'], ['vic', 'viewer'], ['oto', 'manager']] as const) {
      const made = await admin('POST', '/admin/users', { username, displayName: username.toUpperCase(), password: 'password1', role });
      expect(made.status).toBe(201);
    }
    expect((await admin('POST', '/admin/users', { username: 'MIA', displayName: 'Dup', password: 'password1', role: 'viewer' })).status).toBe(409);
    expect((await manager('POST', '/auth/login', { username: 'mia', password: 'wrong-password' })).status).toBe(401);
    expect((await manager('POST', '/auth/login', { username: 'mia', password: 'password1' })).status).toBe(200);
    expect((await viewer('POST', '/auth/login', { username: 'vic', password: 'password1' })).status).toBe(200);
    expect((await outsider('POST', '/auth/login', { username: 'oto', password: 'password1' })).status).toBe(200);
    expect((await manager('GET', '/admin/users')).status).toBe(403);
  });

  it('keeps at least one active administrator', async () => {
    const me = (await admin('GET', '/auth/state')).data.user as User;
    expect((await admin('PATCH', `/admin/users/${me.id}`, { role: 'manager' })).status).toBe(400);
    expect((await admin('PATCH', `/admin/users/${me.id}`, { disabled: true })).status).toBe(400);
    expect((await admin('GET', '/admin/users')).status).toBe(200);
  });
});

describe('projects and access', () => {
  it('lets managers create projects but not viewers', async () => {
    const made = await manager<Project>('POST', '/projects', { name: 'Web Shop', key: 'web' });
    expect(made.status).toBe(201);
    project = made.data;
    expect(project).toMatchObject({ key: 'WEB', access: 'owner', ownerName: 'MIA' });
    expect((await manager('POST', '/projects', { name: 'Again', key: 'WEB' })).status).toBe(409);
    expect((await viewer('POST', '/projects', { name: 'Nope', key: 'NOPE' })).status).toBe(403);
  });

  it('hides projects from people who are not members', async () => {
    expect((await outsider('GET', `/projects/${project.id}/board`)).status).toBe(404);
    expect((await outsider<Project[]>('GET', '/projects')).data).toEqual([]);
    expect((await admin<Project[]>('GET', '/projects')).data).toHaveLength(1);
  });

  it('gives members read or edit access according to their role', async () => {
    const users = (await admin<User[]>('GET', '/admin/users')).data;
    const id = (name: string) => users.find((u) => u.username === name)!.id;
    expect((await manager('PUT', `/projects/${project.id}/members/${id('vic')}`, { role: 'editor' })).status).toBe(204);
    expect((await manager('PUT', `/projects/${project.id}/members/${id('oto')}`, { role: 'viewer' })).status).toBe(204);
    // A global viewer stays read-only even when added as an editor.
    expect((await viewer<Board>('GET', `/projects/${project.id}/board`)).data.project.access).toBe('viewer');
    expect((await viewer('POST', `/projects/${project.id}/items`, { title: 'Nope' })).status).toBe(403);
    expect((await outsider('POST', `/projects/${project.id}/items`, { title: 'Nope' })).status).toBe(403);
    expect((await outsider('DELETE', `/projects/${project.id}`)).status).toBe(403);
    await manager('PUT', `/projects/${project.id}/members/${id('oto')}`, { role: 'editor' });
    expect((await outsider('PATCH', `/projects/${project.id}`, { name: 'Mine now' })).status).toBe(403);
  });
});

describe('backlog', () => {
  const board = async () => (await manager<Board>('GET', `/projects/${project.id}/board`)).data;

  it('numbers new items and adds them at the bottom', async () => {
    for (const title of ['Checkout', 'Search', 'Wishlist']) {
      expect((await manager('POST', `/projects/${project.id}/items`, { title })).status).toBe(201);
    }
    items = (await board()).items;
    expect(items.map((i) => [i.number, i.rank, i.title])).toEqual([[1, 0, 'Checkout'], [2, 1, 'Search'], [3, 2, 'Wishlist']]);
    expect((await manager('POST', `/projects/${project.id}/items`, { title: '  ' })).status).toBe(400);
  });

  it('reorders items, keeping unlisted ones in place after the listed ones', async () => {
    expect((await manager('PUT', `/projects/${project.id}/rank`, { itemIds: [items[2].id, items[0].id] })).status).toBe(204);
    expect((await board()).items.map((i) => i.title)).toEqual(['Wishlist', 'Checkout', 'Search']);
  });

  it('validates fields and links on update', async () => {
    expect((await manager('PATCH', `/items/${items[0].id}`, { moscow: 'maybe' })).status).toBe(400);
    expect((await manager('PATCH', `/items/${items[0].id}`, { epicId: 9999 })).status).toBe(400);
    const epic = (await manager('POST', `/projects/${project.id}/epics`, { title: 'Buying' })).data;
    const release = (await manager('POST', `/projects/${project.id}/releases`, { name: 'R1', capacity: 10 })).data;
    const saved = await manager<Item>('PATCH', `/items/${items[0].id}`, { epicId: epic.id, releaseId: release.id, moscow: 'must', urgency: 'soon', dueDate: '2027-03-01', effort: 3 });
    expect(saved.data).toMatchObject({ epicId: epic.id, releaseId: release.id, moscow: 'must', urgency: 'soon', dueDate: '2027-03-01', effort: 3 });
  });

  it('records dependencies, refuses circles and reports ordering problems', async () => {
    const [checkout, search] = items;
    expect((await manager('POST', `/items/${checkout.id}/dependencies`, { blockerId: search.id })).status).toBe(204);
    expect((await manager('POST', `/items/${search.id}/dependencies`, { blockerId: checkout.id })).status).toBe(400);
    const issues = (await board()).issues.filter((i) => i.itemId === checkout.id).map((i) => i.kind);
    // Checkout is ranked above Search and scheduled in R1 while Search is unscheduled.
    expect(issues).toEqual(expect.arrayContaining(['dep_order', 'dep_release']));
  });
});

describe('import and export', () => {
  it('exports CSV and JSON that import into another project', async () => {
    const csv = (await manager<string>('GET', `/projects/${project.id}/export?format=csv`)).data;
    expect(csv).toContain('WEB-1,story,Checkout');
    const json = (await manager<any>('GET', `/projects/${project.id}/export`)).data;
    expect(json.format).toBe('backlogmatters');

    for (const [key, format, content] of [['CSVP', 'csv', csv], ['JSNP', 'json', JSON.stringify(json)]] as const) {
      const target = (await manager<Project>('POST', '/projects', { name: `Copy ${format}`, key })).data;
      const result = (await manager<ImportResult>('POST', `/projects/${target.id}/import`, { format, content })).data;
      expect(result).toEqual({ items: 3, epics: 1, releases: 1, dependencies: 1, skipped: 0 });
      const copy = (await manager<Board>('GET', `/projects/${target.id}/board`)).data;
      expect(copy.items.map((i) => i.title)).toEqual(['Wishlist', 'Checkout', 'Search']);
      const checkout = copy.items[1];
      expect(checkout).toMatchObject({ moscow: 'must', urgency: 'soon', dueDate: '2027-03-01', effort: 3 });
      expect(copy.epics.find((e) => e.id === checkout.epicId)?.title).toBe('Buying');
      expect(copy.dependencies).toEqual([{ blockerId: copy.items[2].id, blockedId: checkout.id }]);
    }
  });

  it('reads Jira-style columns and turns Epic rows into epics', async () => {
    const target = (await manager<Project>('POST', '/projects', { name: 'Jira', key: 'JIRA' })).data;
    const content = 'Issue Type,Summary,Story Points,Status,Sprint,Priority\nEpic,Payments,,,,\nBug,Card declined,2,In Progress,Sprint 4,Highest\nStory,,1,,,\n';
    const result = (await manager<ImportResult>('POST', `/projects/${target.id}/import`, { format: 'csv', content })).data;
    expect(result).toEqual({ items: 1, epics: 1, releases: 1, dependencies: 0, skipped: 1 });
    const imported = (await manager<Board>('GET', `/projects/${target.id}/board`)).data;
    expect(imported.items[0]).toMatchObject({ type: 'bug', title: 'Card declined', effort: 2, status: 'in_progress', moscow: 'must' });
    const sized = (await manager<ImportResult>('POST', `/projects/${target.id}/import`, { format: 'csv', content: 'Title,MoSCoW,Size\nSized,Could,L\n' })).data;
    expect(sized.items).toBe(1);
    const again = (await manager<Board>('GET', `/projects/${target.id}/board`)).data;
    expect(again.items[1]).toMatchObject({ title: 'Sized', moscow: 'could', effort: 5 });
    expect((await manager('POST', `/projects/${target.id}/import`, { format: 'csv', content: 'a,b\n1,2' })).status).toBe(400);
  });
});

describe('account safety', () => {
  it('signs a user out everywhere when an administrator disables them', async () => {
    const vic = (await admin<User[]>('GET', '/admin/users')).data.find((u) => u.username === 'vic')!;
    expect((await admin('PATCH', `/admin/users/${vic.id}`, { disabled: true })).status).toBe(200);
    expect((await viewer('GET', '/projects')).status).toBe(401);
    expect((await viewer('POST', '/auth/login', { username: 'vic', password: 'password1' })).status).toBe(401);
  });

  it('changes a password only with the current one', async () => {
    expect((await manager('POST', '/auth/password', { current: 'nope', next: 'new-password' })).status).toBe(400);
    expect((await manager('POST', '/auth/password', { current: 'password1', next: 'new-password' })).status).toBe(204);
    expect((await manager('GET', '/projects')).status).toBe(200);
    expect((await client()('POST', '/auth/login', { username: 'mia', password: 'new-password' })).status).toBe(200);
  });

  it('lets an administrator download a backup', async () => {
    expect((await manager('GET', '/admin/backup')).status).toBe(403);
    const res = await admin<string>('GET', '/admin/backup');
    expect(res.status).toBe(200);
    expect(res.data.startsWith('SQLite format 3')).toBe(true);
  });
});
