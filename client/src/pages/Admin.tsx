import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Project, Role, User } from '../../../shared/types';
import { api, useAction } from '../api';
import { ErrorNote, Field, Modal } from '../ui';

const ROLES: Record<Role, string> = { admin: 'Administrator', manager: 'Manager', viewer: 'Viewer' };

export function Admin({ user: me }: { user: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const action = useAction();

  const reload = useCallback(async () => {
    setUsers(await api<User[]>('GET', '/admin/users'));
    setProjects(await api<Project[]>('GET', '/projects'));
  }, []);
  useEffect(() => {
    action.run(reload);
  }, [reload]);

  const change = (request: () => Promise<unknown>) => action.run(request).then(() => reload().catch(() => {}));
  const owners = users.filter((u) => !u.disabled && u.role !== 'viewer');

  return (
    <>
      <div className="heading">
        <h1>Administration</h1>
      </div>
      <ErrorNote message={action.error} />

      <section className="card">
        <header>
          <h2>People</h2>
          <button className="primary" onClick={() => setAdding(true)}>
            Add person
          </button>
        </header>
        <p className="muted">Administrators manage people and see every project. Managers create and own projects. Viewers can only read.</p>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.disabled ? 'done' : ''}>
                <td>
                  {u.displayName} {u.id === me.id && <span className="chip">You</span>}
                </td>
                <td>{u.username}</td>
                <td>
                  <select value={u.role} aria-label={`Role for ${u.displayName}`} onChange={(e) => change(() => api('PATCH', `/admin/users/${u.id}`, { role: e.target.value }))}>
                    {Object.entries(ROLES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{u.disabled ? 'Disabled' : 'Active'}</td>
                <td className="actions">
                  <button onClick={() => setResetting(u)}>Reset password</button>
                  <button onClick={() => change(() => api('PATCH', `/admin/users/${u.id}`, { disabled: !u.disabled }))}>{u.disabled ? 'Enable' : 'Disable'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>All projects</h2>
        {projects.length === 0 && <p className="muted">No projects yet.</p>}
        {projects.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Items</th>
                <th>Owner</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={`#/p/${p.id}/backlog`}>
                      {p.key} · {p.name}
                    </a>
                  </td>
                  <td>
                    {p.openCount} open of {p.itemCount}
                  </td>
                  <td>
                    <select value={p.ownerId} aria-label={`Owner of ${p.name}`} onChange={(e) => change(() => api('PATCH', `/projects/${p.id}`, { ownerId: Number(e.target.value) }))}>
                      {!owners.some((o) => o.id === p.ownerId) && <option value={p.ownerId}>{p.ownerName} (cannot own)</option>}
                      {owners.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.displayName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{p.archived ? 'Archived' : 'Active'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Backup</h2>
        <p className="muted">Downloads a copy of the whole database: every project, item and account. Keep it somewhere safe.</p>
        <a className="button" href="/api/admin/backup">
          Download backup
        </a>
      </section>

      {adding && <AddUser onClose={() => setAdding(false)} onDone={reload} />}
      {resetting && <ResetPassword user={resetting} onClose={() => setResetting(null)} />}
    </>
  );
}

function AddUser({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ displayName: '', username: '', password: '', role: 'manager' as Role });
  const action = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api('POST', '/admin/users', form).then(onDone))) onClose();
  };
  return (
    <Modal title="Add person" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Name">
          <input required autoFocus maxLength={80} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </Field>
        <Field label="Username" hint="Letters, numbers, dots, dashes or underscores">
          <input required minLength={3} maxLength={40} autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
        <Field label="Temporary password" hint="At least 8 characters. Ask them to change it after signing in.">
          <input required minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Role">
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {Object.entries(ROLES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <ErrorNote message={action.error} />
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={action.busy}>
            Add person
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function ResetPassword({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const action = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api('POST', `/admin/users/${user.id}/password`, { password }))) onClose();
  };
  return (
    <Modal title={`Reset password for ${user.displayName}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">They will be signed out everywhere and must use the new password.</p>
        <Field label="New password" hint="At least 8 characters">
          <input required autoFocus minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNote message={action.error} />
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={action.busy}>
            Reset password
          </button>
        </footer>
      </form>
    </Modal>
  );
}
