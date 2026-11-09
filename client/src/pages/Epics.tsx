import { useState, type FormEvent } from 'react';
import type { Epic } from '../../../shared/types';
import { api } from '../api';
import { points, type ProjectCtx } from '../board';
import { Field, Modal } from '../ui';

const COLORS = ['#6b7280', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#d97706', '#059669', '#0891b2'];

export function Epics({ ctx }: { ctx: ProjectCtx }) {
  const { board, canEdit } = ctx;
  const [editing, setEditing] = useState<Epic | 'new' | null>(null);

  return (
    <>
      <div className="toolbar">
        <p className="muted grow">Epics group related stories. Progress counts items marked done.</p>
        {canEdit && (
          <button className="primary" onClick={() => setEditing('new')}>
            New epic
          </button>
        )}
      </div>
      {board.epics.length === 0 && <p className="empty">No epics yet.</p>}
      <div className="grid">
        {board.epics.map((epic) => {
          const items = board.items.filter((i) => i.epicId === epic.id);
          const done = items.filter((i) => i.status === 'done');
          const percent = items.length ? Math.round((done.length / items.length) * 100) : 0;
          return (
            <section key={epic.id} className="card" style={{ borderTop: `4px solid ${epic.color}` }}>
              <header>
                <h2 className={epic.done ? 'struck' : ''}>{epic.title}</h2>
                {canEdit && (
                  <button className="ghost" onClick={() => setEditing(epic)}>
                    Edit
                  </button>
                )}
              </header>
              {epic.description && <p className="muted">{epic.description}</p>}
              <div className="meter">
                <div style={{ width: `${percent}%` }} />
              </div>
              <p className="meta">
                {done.length} of {items.length} items done · {points(done)} of {points(items)} pt
              </p>
            </section>
          );
        })}
      </div>
      {editing && <EpicForm ctx={ctx} epic={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EpicForm({ ctx, epic, onClose }: { ctx: ProjectCtx; epic: Epic | null; onClose: () => void }) {
  const [form, setForm] = useState({
    title: epic?.title ?? '',
    description: epic?.description ?? '',
    color: epic?.color ?? COLORS[1],
    done: epic?.done ?? false,
  });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const send = () => (epic ? api('PATCH', `/epics/${epic.id}`, form) : api('POST', `/projects/${ctx.board.project.id}/epics`, form));
    if (await ctx.run(send)) onClose();
  };
  const remove = async () => {
    if (confirm(`Delete the epic “${epic!.title}”? Its items are kept without an epic.`) && (await ctx.run(() => api('DELETE', `/epics/${epic!.id}`)))) onClose();
  };
  return (
    <Modal title={epic ? 'Edit epic' : 'New epic'} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Title">
          <input required autoFocus maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="swatches" role="radiogroup" aria-label="Color">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={form.color === c}
              aria-label={c}
              className={form.color === c ? 'selected' : ''}
              style={{ background: c }}
              onClick={() => setForm({ ...form, color: c })}
            />
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={form.done} onChange={(e) => setForm({ ...form, done: e.target.checked })} />
          This epic is finished
        </label>
        <footer>
          {epic && (
            <button type="button" className="danger" onClick={remove}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save</button>
        </footer>
      </form>
    </Modal>
  );
}
