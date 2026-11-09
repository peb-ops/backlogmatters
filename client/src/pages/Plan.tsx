import { useState, type FormEvent } from 'react';
import type { Item, Release, ReleaseStatus } from '../../../shared/types';
import { api } from '../api';
import { points, type ProjectCtx } from '../board';
import { MOSCOW, MOSCOW_LABEL, MUST_SHARE_LIMIT, sizeOf } from '../../../shared/logic';
import { Field, Modal, MoscowChip, toNumber } from '../ui';

const STATUS: Record<ReleaseStatus, string> = { planned: 'Planned', active: 'Active', done: 'Done' };

export function Plan({ ctx }: { ctx: ProjectCtx }) {
  const { board, canEdit } = ctx;
  const [editing, setEditing] = useState<Release | 'new' | null>(null);
  const unscheduled = board.items.filter((i) => i.releaseId == null && i.status !== 'done');

  return (
    <>
      <div className="toolbar">
        <p className="muted grow">Assign items to releases or sprints and compare the estimated points with each one’s capacity.</p>
        {canEdit && (
          <button className="primary" onClick={() => setEditing('new')}>
            New release
          </button>
        )}
      </div>
      <div className="grid plan">
        <Column ctx={ctx} title="Unscheduled" items={unscheduled} />
        {board.releases.map((r) => (
          <Column key={r.id} ctx={ctx} title={r.name} release={r} items={board.items.filter((i) => i.releaseId === r.id)} onEdit={canEdit ? () => setEditing(r) : undefined} />
        ))}
      </div>
      {editing && <ReleaseForm ctx={ctx} release={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function Column(props: { ctx: ProjectCtx; title: string; items: Item[]; release?: Release; onEdit?: () => void }) {
  const { ctx, release, items } = props;
  const used = points(items);
  const unestimated = items.filter((i) => i.effort == null).length;
  const over = release?.capacity != null && used > release.capacity;
  const split = MOSCOW.map((moscow) => ({ moscow, pts: points(items.filter((i) => i.moscow === moscow)) })).filter((s) => s.pts > 0);
  const categorised = split.reduce((sum, s) => sum + s.pts, 0);
  const mustShare = release?.capacity ? (split.find((s) => s.moscow === 'must')?.pts ?? 0) / release.capacity : 0;

  return (
    <section className="card column">
      <header>
        <h2>{props.title}</h2>
        {release && <span className="chip">{STATUS[release.status]}</span>}
        {props.onEdit && (
          <button className="ghost" onClick={props.onEdit}>
            Edit
          </button>
        )}
      </header>
      {release && (release.startDate || release.endDate) && (
        <p className="meta">
          {release.startDate ?? '…'} to {release.endDate ?? '…'}
        </p>
      )}
      <p className={over ? 'meta over' : 'meta'}>
        {used} pt{release?.capacity != null && ` of ${release.capacity} capacity`}
        {over && ` · over by ${used - release!.capacity!}`}
        {unestimated > 0 && ` · ${unestimated} not estimated`}
      </p>
      {release?.capacity != null && release.capacity > 0 && (
        <div className="meter stacked">
          {split.map((s) => (
            <div key={s.moscow} className={`moscow-${s.moscow}`} style={{ width: `${(s.pts / Math.max(release.capacity!, used)) * 100}%` }} />
          ))}
          <div className="other" style={{ width: `${((used - categorised) / Math.max(release.capacity, used)) * 100}%` }} />
        </div>
      )}
      {split.length > 0 && <p className="meta">{split.map((s) => `${MOSCOW_LABEL[s.moscow]} ${s.pts}`).join(' · ')} pt</p>}
      {mustShare > MUST_SHARE_LIMIT && (
        <p className="meta over">
          Must-haves take {Math.round(mustShare * 100)}% of capacity. Aim for {MUST_SHARE_LIMIT * 100}% or less so there is room for surprises.
        </p>
      )}
      {items.length === 0 && <p className="muted">No items.</p>}
      <ul className="plain">
        {items.map((item) => (
          <li key={item.id} className={item.status === 'done' ? 'done' : ''}>
            <MoscowChip moscow={item.moscow} />
            <button className="link title" onClick={() => ctx.open(item.id)}>
              <span className="muted">{ctx.itemKey(item)}</span> {item.title}
            </button>
            {(ctx.issues.get(item.id) ?? []).some((i) => i.kind === 'dep_release') && (
              <span className="chip warn" title={ctx.issues.get(item.id)!.filter((i) => i.kind === 'dep_release').map((i) => i.detail).join('\n')}>
                ⚠
              </span>
            )}
            <span className="num" title={item.effort == null ? 'No size yet' : `${item.effort} points`}>
              {sizeOf(item.effort)?.name ?? '–'}
            </span>
            {ctx.canEdit && (
              <select
                value={item.releaseId ?? ''}
                aria-label={`Release for ${item.title}`}
                onChange={(e) => ctx.run(() => api('PATCH', `/items/${item.id}`, { releaseId: toNumber(e.target.value) }))}
              >
                <option value="">Unscheduled</option>
                {ctx.board.releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReleaseForm({ ctx, release, onClose }: { ctx: ProjectCtx; release: Release | null; onClose: () => void }) {
  const [form, setForm] = useState({
    name: release?.name ?? '',
    startDate: release?.startDate ?? null,
    endDate: release?.endDate ?? null,
    capacity: release?.capacity ?? null,
    status: release?.status ?? ('planned' as ReleaseStatus),
  });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const request = release ? api('PATCH', `/releases/${release.id}`, form) : api('POST', `/projects/${ctx.board.project.id}/releases`, form);
    if (await ctx.run(() => request)) onClose();
  };
  const remove = async () => {
    if (confirm(`Delete ${release!.name}? Its items become unscheduled.`) && (await ctx.run(() => api('DELETE', `/releases/${release!.id}`)))) onClose();
  };
  return (
    <Modal title={release ? 'Edit release' : 'New release'} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Name">
          <input required autoFocus maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="cols">
          <Field label="Start">
            <input type="date" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value || null })} />
          </Field>
          <Field label="End">
            <input type="date" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value || null })} />
          </Field>
          <Field label="Capacity (points)">
            <input type="number" min={0} step={0.5} value={form.capacity ?? ''} onChange={(e) => setForm({ ...form, capacity: toNumber(e.target.value) })} />
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ReleaseStatus })}>
              {Object.entries(STATUS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <footer>
          {release && (
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
