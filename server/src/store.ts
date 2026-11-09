import type Database from 'better-sqlite3';
import { computeIssues } from '../../shared/logic';
import type {
  Access,
  Board,
  Dependency,
  Epic,
  Item,
  Member,
  MemberRole,
  Project,
  Release,
  Role,
  User,
  UserSummary,
} from '../../shared/types';

const USER = `u.id, u.username, u.display_name AS displayName, u.role, u.disabled, u.created_at AS createdAt`;
const EPIC = `id, project_id AS projectId, title, description, color, done`;
const RELEASE = `id, project_id AS projectId, name, start_date AS startDate, end_date AS endDate, capacity, status`;
const ITEM = `id, project_id AS projectId, number, epic_id AS epicId, release_id AS releaseId, type, title,
  description, acceptance_criteria AS acceptanceCriteria, status, moscow, urgency, due_date AS dueDate, effort, rank,
  created_at AS createdAt, updated_at AS updatedAt`;

const now = () => new Date().toISOString();
const snake = (s: string) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const toUser = (r: any): User | undefined => r && { ...r, disabled: !!r.disabled };
const toEpic = (r: any): Epic => ({ ...r, done: !!r.done });

export type EpicInput = Partial<Omit<Epic, 'id' | 'projectId'>>;
export type ReleaseInput = Partial<Omit<Release, 'id' | 'projectId'>>;
export type ItemInput = Partial<
  Pick<
    Item,
    'epicId' | 'releaseId' | 'type' | 'title' | 'description' | 'acceptanceCriteria' | 'status' | 'moscow' | 'urgency' | 'dueDate' | 'effort'
  >
>;

/**
 * All database access goes through this class, so the storage engine can be
 * replaced (for example by a server database in company-wide deployments)
 * without touching the routes.
 */
export class Store {
  constructor(readonly db: Database.Database) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // Field names are camelCase keys chosen by the caller's schema, never raw user input.
  private insert(table: string, fields: Record<string, unknown>): number {
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    const sql = `INSERT INTO ${table} (${keys.map(snake).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    return Number(this.db.prepare(sql).run(...keys.map((k) => this.bind(fields[k]))).lastInsertRowid);
  }

  private update(table: string, id: number, fields: Record<string, unknown>): void {
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (!keys.length) return;
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${snake(k)} = ?`).join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...keys.map((k) => this.bind(fields[k])), id);
  }

  private bind(v: unknown): unknown {
    return typeof v === 'boolean' ? Number(v) : v;
  }

  // ---- users ----

  countUsers(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  activeAdminCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND username != 'local user'`).get();
    return (row as { n: number }).n;
  }

  getUser(id: number): User | undefined {
    return toUser(this.db.prepare(`SELECT ${USER} FROM users u WHERE u.id = ?`).get(id));
  }

  getCredentials(username: string): { id: number; passwordHash: string; disabled: number } | undefined {
    return this.db
      .prepare('SELECT id, password_hash AS passwordHash, disabled FROM users WHERE username = ?')
      .get(username) as any;
  }

  getPasswordHash(id: number): string | undefined {
    return (this.db.prepare('SELECT password_hash AS h FROM users WHERE id = ?').get(id) as any)?.h;
  }

  listUsers(): User[] {
    // The built-in local user is not a person to manage, so administration never sees it.
    return this.db.prepare(`SELECT ${USER} FROM users u WHERE u.username != 'local user' ORDER BY u.display_name`).all().map((r) => toUser(r)!);
  }

  listActiveUsers(): UserSummary[] {
    return this.db
      .prepare('SELECT id, username, display_name AS displayName FROM users WHERE disabled = 0 ORDER BY display_name')
      .all() as UserSummary[];
  }

  createUser(u: { username: string; displayName: string; passwordHash: string; role: Role }): User {
    return this.getUser(this.insert('users', { ...u, createdAt: now() }))!;
  }

  /**
   * The built-in account everything runs as while sign-in is switched off. It is kept
   * disabled with an unusable password so nobody can sign in as it once accounts are on,
   * and its username contains a space, which real usernames cannot.
   */
  localUser(): User {
    const find = () => toUser(this.db.prepare(`SELECT ${USER} FROM users u WHERE u.username = 'local user'`).get());
    return (
      find() ??
      this.transaction(() => {
        const made = this.createUser({ username: 'local user', displayName: 'Local user', passwordHash: '!', role: 'admin' });
        this.updateUser(made.id, { disabled: true });
        return find()!;
      })
    );
  }

  updateUser(id: number, patch: { displayName?: string; role?: Role; disabled?: boolean }): void {
    this.update('users', id, patch);
  }

  setPassword(id: number, passwordHash: string): void {
    this.update('users', id, { passwordHash });
  }

  // ---- sessions ----

  createSession(tokenHash: string, userId: number, expiresAt: string): void {
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, userId, expiresAt);
  }

  sessionUser(tokenHash: string): User | undefined {
    return toUser(
      this.db
        .prepare(
          `SELECT ${USER} FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
        )
        .get(tokenHash, now()),
    );
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  deleteUserSessions(userId: number): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  purgeExpiredSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
  }

  // ---- projects ----

  /** Projects the user can see. Administrators see every project. */
  listProjects(user: User, onlyId?: number): Project[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.key, p.name, p.description, p.owner_id AS ownerId, u.display_name AS ownerName,
                p.archived, p.created_at AS createdAt, m.role AS memberRole,
                (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id) AS itemCount,
                (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id AND i.status != 'done') AS openCount
         FROM projects p
         JOIN users u ON u.id = p.owner_id
         LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = @uid
         WHERE (@all = 1 OR p.owner_id = @uid OR m.user_id IS NOT NULL)
           AND (@pid IS NULL OR p.id = @pid)
         ORDER BY p.archived, p.name`,
      )
      .all({ uid: user.id, all: user.role === 'admin' ? 1 : 0, pid: onlyId ?? null }) as any[];
    return rows.map(({ memberRole, ...p }) => {
      let access: Access = user.role === 'admin' || p.ownerId === user.id ? 'owner' : memberRole;
      if (user.role === 'viewer') access = 'viewer';
      return { ...p, archived: !!p.archived, access };
    });
  }

  getProject(user: User, id: number): Project | undefined {
    return this.listProjects(user, id)[0];
  }

  keyTaken(key: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM projects WHERE key = ?').get(key);
  }

  createProject(p: { key: string; name: string; description?: string; ownerId: number }): number {
    return this.insert('projects', { ...p, createdAt: now() });
  }

  updateProject(id: number, patch: { name?: string; description?: string; archived?: boolean; ownerId?: number }): void {
    this.update('projects', id, patch);
  }

  deleteProject(id: number): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  listMembers(projectId: number): Member[] {
    return this.db
      .prepare(
        `SELECT u.id, u.username, u.display_name AS displayName, m.role
         FROM project_members m JOIN users u ON u.id = m.user_id
         WHERE m.project_id = ? ORDER BY u.display_name`,
      )
      .all(projectId) as Member[];
  }

  setMember(projectId: number, userId: number, role: MemberRole): void {
    this.db
      .prepare(
        `INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role`,
      )
      .run(projectId, userId, role);
  }

  removeMember(projectId: number, userId: number): void {
    this.db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, userId);
  }

  // ---- epics ----

  listEpics(projectId: number): Epic[] {
    return this.db.prepare(`SELECT ${EPIC} FROM epics WHERE project_id = ? ORDER BY done, title`).all(projectId).map(toEpic);
  }

  getEpic(id: number): Epic | undefined {
    const row = this.db.prepare(`SELECT ${EPIC} FROM epics WHERE id = ?`).get(id);
    return row ? toEpic(row) : undefined;
  }

  createEpic(projectId: number, data: EpicInput & { title: string }): number {
    return this.insert('epics', { ...data, projectId });
  }

  updateEpic(id: number, patch: EpicInput): void {
    this.update('epics', id, patch);
  }

  deleteEpic(id: number): void {
    this.db.prepare('DELETE FROM epics WHERE id = ?').run(id);
  }

  // ---- releases ----

  listReleases(projectId: number): Release[] {
    return this.db
      .prepare(`SELECT ${RELEASE} FROM releases WHERE project_id = ? ORDER BY start_date IS NULL, start_date, id`)
      .all(projectId) as Release[];
  }

  getRelease(id: number): Release | undefined {
    return this.db.prepare(`SELECT ${RELEASE} FROM releases WHERE id = ?`).get(id) as Release | undefined;
  }

  createRelease(projectId: number, data: ReleaseInput & { name: string }): number {
    return this.insert('releases', { ...data, projectId });
  }

  updateRelease(id: number, patch: ReleaseInput): void {
    this.update('releases', id, patch);
  }

  deleteRelease(id: number): void {
    this.db.prepare('DELETE FROM releases WHERE id = ?').run(id);
  }

  // ---- items ----

  listItems(projectId: number): Item[] {
    return this.db.prepare(`SELECT ${ITEM} FROM items WHERE project_id = ? ORDER BY rank, id`).all(projectId) as Item[];
  }

  getItem(id: number): Item | undefined {
    return this.db.prepare(`SELECT ${ITEM} FROM items WHERE id = ?`).get(id) as Item | undefined;
  }

  /** New items take the next number in the project and go to the bottom of the ranking. */
  createItem(projectId: number, data: ItemInput & { title: string }, createdBy?: number): number {
    return this.transaction(() => {
      const { n } = this.db.prepare('SELECT next_number AS n FROM projects WHERE id = ?').get(projectId) as { n: number };
      this.db.prepare('UPDATE projects SET next_number = ? WHERE id = ?').run(n + 1, projectId);
      const { r } = this.db
        .prepare('SELECT COALESCE(MAX(rank), -1) + 1 AS r FROM items WHERE project_id = ?')
        .get(projectId) as { r: number };
      const at = now();
      return this.insert('items', { ...data, projectId, number: n, rank: r, createdBy, createdAt: at, updatedAt: at });
    });
  }

  updateItem(id: number, patch: ItemInput): void {
    this.update('items', id, { ...patch, updatedAt: now() });
  }

  deleteItem(id: number): void {
    this.db.prepare('DELETE FROM items WHERE id = ?').run(id);
  }

  /** Applies a new order. Ids not listed keep their relative order after the listed ones. */
  reorder(projectId: number, itemIds: number[]): void {
    this.transaction(() => {
      const existing = this.listItems(projectId).map((i) => i.id);
      const known = new Set(existing);
      const listed = [...new Set(itemIds)].filter((id) => known.has(id));
      const listedSet = new Set(listed);
      const order = [...listed, ...existing.filter((id) => !listedSet.has(id))];
      const set = this.db.prepare('UPDATE items SET rank = ? WHERE id = ?');
      order.forEach((id, index) => set.run(index, id));
    });
  }

  // ---- dependencies ----

  listDependencies(projectId: number): Dependency[] {
    return this.db
      .prepare(
        `SELECT d.blocker_id AS blockerId, d.blocked_id AS blockedId
         FROM dependencies d JOIN items i ON i.id = d.blocked_id WHERE i.project_id = ?`,
      )
      .all(projectId) as Dependency[];
  }

  addDependency(blockerId: number, blockedId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO dependencies (blocker_id, blocked_id) VALUES (?, ?)').run(blockerId, blockedId);
  }

  removeDependency(blockerId: number, blockedId: number): void {
    this.db.prepare('DELETE FROM dependencies WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, blockedId);
  }

  // ---- aggregate ----

  board(project: Project): Board {
    const items = this.listItems(project.id);
    const releases = this.listReleases(project.id);
    const dependencies = this.listDependencies(project.id);
    return {
      project,
      epics: this.listEpics(project.id),
      releases,
      items,
      dependencies,
      members: this.listMembers(project.id),
      issues: computeIssues(items, dependencies, releases),
    };
  }

  backup(): Buffer {
    return this.db.serialize();
  }
}
