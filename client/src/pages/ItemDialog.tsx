import { useState, type FormEvent } from 'react';
import { MOSCOW, MOSCOW_ABOUT, MOSCOW_LABEL, SIZES, URGENCIES, URGENCY_ABOUT, URGENCY_LABEL, effectiveUrgency, score, sizeOf } from '../../../shared/logic';
import type { Item, ItemStatus, ItemType } from '../../../shared/types';
import { api } from '../api';
import { STATUS_LABEL, TYPE_LABEL, type ProjectCtx } from '../board';
import { Choice, Field, Modal, ScoringHelp, toNumber } from '../ui';

export function ItemDialog({ ctx, item, onClose }: { ctx: ProjectCtx; item: Item; onClose: () => void }) {
  const { board, canEdit } = ctx;
  const [form, setForm] = useState({
    title: item.title,
    type: item.type,
    status: item.status,
    epicId: item.epicId,
    releaseId: item.releaseId,
    moscow: item.moscow,
    urgency: item.urgency,
    dueDate: item.dueDate,
    effort: item.effort,
    description: item.description,
    acceptanceCriteria: item.acceptanceCriteria,
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const blockers = board.dependencies.filter((d) => d.blockedId === item.id).map((d) => board.items.find((i) => i.id === d.blockerId)!);
  const blocking = board.dependencies.filter((d) => d.blockerId === item.id).map((d) => board.items.find((i) => i.id === d.blockedId)!);
  const candidates = board.items.filter((i) => i.id !== item.id && !blockers.includes(i));
  const issues = ctx.issues.get(item.id) ?? [];
  const formScore = score(form);
  const size = sizeOf(form.effort);
  const raised = effectiveUrgency(form);
  const dueHint =
    form.dueDate && raised && raised !== form.urgency
      ? `This date makes the urgency “${URGENCY_LABEL[raised]}”.`
      : 'Urgency rises on its own as the date gets close.';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await ctx.run(() => api('PATCH', `/items/${item.id}`, form))) onClose();
  };
  const remove = async () => {
    if (confirm(`Delete ${ctx.itemKey(item)}? This cannot be undone.`) && (await ctx.run(() => api('DELETE', `/items/${item.id}`)))) onClose();
  };

  return (
    <Modal title={ctx.itemKey(item)} onClose={onClose}>
      <form onSubmit={save}>
        <fieldset disabled={!canEdit}>
          <Field label="Title">
            <input required maxLength={200} value={form.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <div className="cols">
            <Field label="Type">
              <select value={form.type} onChange={(e) => set({ type: e.target.value as ItemType })}>
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => set({ status: e.target.value as ItemStatus })}>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Epic">
              <select value={form.epicId ?? ''} onChange={(e) => set({ epicId: toNumber(e.target.value) })}>
                <option value="">None</option>
                {board.epics.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Release">
              <select value={form.releaseId ?? ''} onChange={(e) => set({ releaseId: toNumber(e.target.value) })}>
                <option value="">Unscheduled</option>
                {board.releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Choice
            label="Priority: how much does the release need this?"
            value={form.moscow}
            onChange={(moscow) => set({ moscow })}
            options={MOSCOW.map((m) => ({ value: m, label: MOSCOW_LABEL[m], about: MOSCOW_ABOUT[m], className: `moscow-${m}` }))}
          />
          <Choice
            label="Urgency: what does waiting cost?"
            value={form.urgency}
            onChange={(urgency) => set({ urgency })}
            options={URGENCIES.map((u) => ({ value: u, label: URGENCY_LABEL[u], about: URGENCY_ABOUT[u] }))}
          />
          <Field label="Due date (optional)" hint={dueHint}>
            <input type="date" value={form.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null })} />
          </Field>
          <Choice
            label="Size: how big is the work?"
            value={size?.name ?? null}
            onChange={(name) => set({ effort: SIZES.find((s) => s.name === name)?.points ?? null })}
            options={SIZES.map((s) => ({ value: s.name, label: s.name, about: s.about }))}
          />
          <p className="muted">
            {size && form.effort !== size.points && `Imported estimate of ${form.effort} points, shown as ${size.name}. `}
            {formScore != null
              ? `Suggested score ${formScore}: benefit for the work involved. Higher is better.`
              : form.moscow === 'wont'
                ? 'Won’t-haves are left out of the suggested order.'
                : 'Pick a priority and a size to get a suggested score.'}
          </p>
          <ScoringHelp />
          <Field label="Description">
            <textarea rows={4} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="Acceptance criteria">
            <textarea rows={4} value={form.acceptanceCriteria} onChange={(e) => set({ acceptanceCriteria: e.target.value })} />
          </Field>
        </fieldset>

        <h3>Blocked by</h3>
        {blockers.length === 0 && <p className="muted">Nothing blocks this item.</p>}
        <ul className="plain">
          {blockers.map((b) => (
            <li key={b.id}>
              <span className={b.status === 'done' ? 'struck' : ''}>
                {ctx.itemKey(b)} {b.title}
              </span>
              {canEdit && (
                <button type="button" className="ghost" onClick={() => ctx.run(() => api('DELETE', `/items/${item.id}/dependencies/${b.id}`))}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && candidates.length > 0 && (
          <select
            value=""
            aria-label="Add a blocker"
            onChange={(e) => ctx.run(() => api('POST', `/items/${item.id}/dependencies`, { blockerId: Number(e.target.value) }))}
          >
            <option value="">Add an item that blocks this one…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {ctx.itemKey(c)} {c.title}
              </option>
            ))}
          </select>
        )}
        {blocking.length > 0 && (
          <p className="muted">Blocks: {blocking.map((b) => ctx.itemKey(b)).join(', ')}</p>
        )}

        {issues.length > 0 && (
          <>
            <h3>Needs attention</h3>
            <ul className="issues">
              {issues.map((i) => (
                <li key={i.kind + i.detail}>{i.detail}</li>
              ))}
            </ul>
          </>
        )}

        {canEdit && (
          <footer>
            <button type="button" className="danger" onClick={remove}>
              Delete
            </button>
            <span className="spacer" />
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary">Save</button>
          </footer>
        )}
      </form>
    </Modal>
  );
}
