import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { ImportResult, MemberRole, UserSummary } from '../../../shared/types';
import { api } from '../api';
import type { ProjectCtx } from '../board';
import { Field } from '../ui';

export function Settings({ ctx }: { ctx: ProjectCtx }) {
  return (
    <>
      <Transfer ctx={ctx} />
      {!ctx.accounts && <Backup />}
      {ctx.isOwner ? (
        <>
          <Details ctx={ctx} />
          {ctx.accounts && <Members ctx={ctx} />}
        </>
      ) : (
        <p className="muted">Only the project owner or an administrator can change the project details and who has access.</p>
      )}
    </>
  );
}

function Transfer({ ctx }: { ctx: ProjectCtx }) {
  const { project } = ctx.board;
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setResult(null);
    const format = file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
    const content = await file.text();
    await ctx.run(() => api<ImportResult>('POST', `/projects/${project.id}/import`, { format, content }).then(setResult));
  };

  return (
    <section className="card">
      <h2>Import and export</h2>
      <p className="muted">
        CSV opens in Excel and can be exchanged with Jira or Trello. The BacklogMatters file (JSON) keeps everything, including releases and
        dependencies, and is the best way to pass a backlog to another person.
      </p>
      <div className="toolbar">
        <a className="button" href={`/api/projects/${project.id}/export?format=csv`}>
          Export CSV
        </a>
        <a className="button" href={`/api/projects/${project.id}/export`}>
          Export BacklogMatters file
        </a>
        {ctx.canEdit && (
          <label className="button">
            Import a CSV or BacklogMatters file…
            <input type="file" accept=".csv,.json" hidden onChange={onFile} />
          </label>
        )}
      </div>
      {ctx.canEdit && <p className="muted">Importing adds items to this project. It never changes or removes existing ones.</p>}
      {result && (
        <p className="ok">
          Imported {result.items} items, {result.epics} new epics, {result.releases} new releases and {result.dependencies} dependencies.
          {result.skipped > 0 && ` Skipped ${result.skipped} rows without a title.`}
        </p>
      )}
    </section>
  );
}

/** Shown only with accounts off; with accounts on, administrators download backups from the administration page. */
function Backup() {
  return (
    <section className="card">
      <h2>Backup</h2>
      <p className="muted">
        Downloads a copy of the whole database: every project, not only this one. Keep it somewhere safe, such as another drive or a cloud
        folder. To restore it, close BacklogMatters and put the file in the data folder as backlogmatters.db.
      </p>
      <div className="toolbar">
        <a className="button" href="/api/backup">
          Download backup
        </a>
      </div>
    </section>
  );
}

function Details({ ctx }: { ctx: ProjectCtx }) {
  const { project } = ctx.board;
  const [form, setForm] = useState({ name: project.name, description: project.description });
  const save = (e: FormEvent) => {
    e.preventDefault();
    ctx.run(() => api('PATCH', `/projects/${project.id}`, form));
  };
  const remove = async () => {
    const typed = prompt(`This permanently deletes ${project.name} and its ${project.itemCount} items. Type ${project.key} to confirm.`);
    if (typed?.trim().toUpperCase() !== project.key) return;
    if (await ctx.run(() => api('DELETE', `/projects/${project.id}`))) location.hash = '#/';
  };
  return (
    <section className="card">
      <h2>Project details</h2>
      <form onSubmit={save}>
        <Field label="Name">
          <input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <footer>
          <button type="button" className="danger" onClick={remove}>
            Delete project
          </button>
          <span className="spacer" />
          <button type="button" onClick={() => ctx.run(() => api('PATCH', `/projects/${project.id}`, { archived: !project.archived }))}>
            {project.archived ? 'Restore from archive' : 'Archive'}
          </button>
          <button className="primary">Save</button>
        </footer>
      </form>
    </section>
  );
}

function Members({ ctx }: { ctx: ProjectCtx }) {
  const { project, members } = ctx.board;
  const [users, setUsers] = useState<UserSummary[]>([]);
  useEffect(() => {
    api<UserSummary[]>('GET', '/users').then(setUsers, () => {});
  }, []);
  const candidates = users.filter((u) => u.id !== project.ownerId && !members.some((m) => m.id === u.id));
  const setRole = (userId: number, role: MemberRole) => ctx.run(() => api('PUT', `/projects/${project.id}/members/${userId}`, { role }));

  return (
    <section className="card">
      <h2>Who has access</h2>
      <ul className="plain">
        <li>
          <span className="title">{project.ownerName}</span>
          <span className="chip">Owner</span>
        </li>
        {members.map((m) => (
          <li key={m.id}>
            <span className="title">
              {m.displayName} <span className="muted">{m.username}</span>
            </span>
            <select value={m.role} aria-label={`Access for ${m.displayName}`} onChange={(e) => setRole(m.id, e.target.value as MemberRole)}>
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </select>
            <button className="ghost" onClick={() => ctx.run(() => api('DELETE', `/projects/${project.id}/members/${m.id}`))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {candidates.length > 0 ? (
        <select value="" aria-label="Add a person" onChange={(e) => setRole(Number(e.target.value), 'editor')}>
          <option value="">Add a person…</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} ({u.username})
            </option>
          ))}
        </select>
      ) : (
        <p className="muted">Everyone with an account already has access. An administrator can add more people.</p>
      )}
      <p className="muted">People whose account role is Viewer can only view, whatever access they are given here.</p>
    </section>
  );
}
