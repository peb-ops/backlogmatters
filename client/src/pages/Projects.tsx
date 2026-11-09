import { useEffect, useState, type FormEvent } from 'react';
import type { Project, User } from '../../../shared/types';
import { api, useAction } from '../api';
import { ErrorNote, Field, Modal } from '../ui';

/** "Web Shop" -> "WS", "Billing" -> "BIL". */
function suggestKey(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3);
  return key.replace(/^[0-9]+/, '').slice(0, 6);
}

export function Projects({ user, accounts }: { user: User; accounts: boolean }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const load = useAction();

  useEffect(() => {
    load.run(() => api<Project[]>('GET', '/projects').then(setProjects));
  }, []);

  const visible = (projects ?? []).filter((p) => showArchived || !p.archived);
  const archivedCount = (projects ?? []).filter((p) => p.archived).length;

  return (
    <>
      <div className="heading">
        <h1>Projects</h1>
        {archivedCount > 0 && (
          <label className="check">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived ({archivedCount})
          </label>
        )}
        {!accounts && (
          <a className="button" href="/api/backup" title="A copy of every project in one file. Keep it somewhere safe.">
            Download backup
          </a>
        )}
        {user.role !== 'viewer' && (
          <button className="primary" onClick={() => setCreating(true)}>
            New project
          </button>
        )}
      </div>
      <ErrorNote message={load.error} />
      {projects && visible.length === 0 && (
        <p className="empty">
          {user.role === 'viewer' ? 'No projects have been shared with you yet.' : 'No projects yet. Create one to start a backlog.'}
        </p>
      )}
      <div className="grid">
        {visible.map((p) => (
          <a key={p.id} className="card project" href={`#/p/${p.id}/backlog`}>
            <span className="chip">{p.key}</span>
            {p.archived && <span className="chip muted">Archived</span>}
            <h2>{p.name}</h2>
            <p className="muted">{p.description || 'No description'}</p>
            <p className="meta">
              {p.openCount} open of {p.itemCount} items
              {accounts && ` · ${p.ownerId === user.id ? 'You own this' : `Owner: ${p.ownerName}`}`}
            </p>
          </a>
        ))}
      </div>
      {creating && <NewProject onClose={() => setCreating(false)} />}
    </>
  );
}

function NewProject({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const action = useAction();
  const effectiveKey = key ?? suggestKey(name);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await action.run(async () => {
      const made = await api<Project>('POST', '/projects', { name, key: effectiveKey, description });
      location.hash = `#/p/${made.id}/backlog`;
    });
  };

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Name">
          <input required autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Key" hint="Short code used in item numbers, for example WEB-12">
          <input required maxLength={6} value={effectiveKey} onChange={(e) => setKey(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Description">
          <textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <ErrorNote message={action.error} />
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={action.busy}>
            Create project
          </button>
        </footer>
      </form>
    </Modal>
  );
}
