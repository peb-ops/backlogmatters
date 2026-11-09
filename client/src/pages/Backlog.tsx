import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { MOSCOW, MOSCOW_LABEL, URGENCY_LABEL, bySuggestion, effectiveUrgency, score, sizeOf } from '../../../shared/logic';
import type { Item, ItemStatus, ItemType } from '../../../shared/types';
import { api } from '../api';
import { STATUS_LABEL, TYPE_LABEL, type ProjectCtx } from '../board';
import { MoscowChip, ScoringHelp } from '../ui';

export function Backlog({ ctx }: { ctx: ProjectCtx }) {
  const { board, canEdit } = ctx;
  const [search, setSearch] = useState('');
  const [epic, setEpic] = useState('all');
  const [moscow, setMoscow] = useState('all');
  const [showDone, setShowDone] = useState(false);
  const [sort, setSort] = useState<'rank' | 'score'>('rank');
  // Order shown while a drag is being saved, so the row does not jump back.
  const [pending, setPending] = useState<Item[] | null>(null);
  useEffect(() => setPending(null), [board]);

  const ranked = pending ?? board.items;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = ranked.filter(
      (i) =>
        (showDone || i.status !== 'done') &&
        (epic === 'all' || (epic === 'none' ? i.epicId == null : i.epicId === Number(epic))) &&
        (moscow === 'all' || (moscow === 'none' ? i.moscow == null : i.moscow === moscow)) &&
        (!q || i.title.toLowerCase().includes(q) || ctx.itemKey(i).toLowerCase().includes(q)),
    );
    return sort === 'score' ? [...list].sort((a, b) => bySuggestion(a, b)) : list;
  }, [ranked, search, epic, moscow, showDone, sort]);

  const draggable = canEdit && sort === 'rank';
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Puts the visible items in their new order into the same slots they held in the full ranking. */
  function saveOrder(newVisible: Item[]) {
    const visibleIds = new Set(newVisible.map((i) => i.id));
    let next = 0;
    const full = ranked.map((i) => (visibleIds.has(i.id) ? newVisible[next++] : i));
    setPending(full);
    ctx.run(() => api('PUT', `/projects/${board.project.id}/rank`, { itemIds: full.map((i) => i.id) }));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = visible.findIndex((i) => i.id === active.id);
    const to = visible.findIndex((i) => i.id === over.id);
    if (from >= 0 && to >= 0) saveOrder(arrayMove(visible, from, to));
  }

  const moveToTop = (item: Item) => saveOrder([item, ...visible.filter((i) => i.id !== item.id)]);

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Search title or key" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={epic} onChange={(e) => setEpic(e.target.value)} aria-label="Filter by epic">
          <option value="all">All epics</option>
          <option value="none">No epic</option>
          {board.epics.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
        <select value={moscow} onChange={(e) => setMoscow(e.target.value)} aria-label="Filter by priority">
          <option value="all">All priorities</option>
          {MOSCOW.map((m) => (
            <option key={m} value={m}>
              {MOSCOW_LABEL[m]}
            </option>
          ))}
          <option value="none">No priority yet</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'rank' | 'score')} aria-label="Sort">
          <option value="rank">Your ranking</option>
          <option value="score">Suggested order</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show done
        </label>
      </div>
      {canEdit && <QuickAdd ctx={ctx} />}
      {sort === 'score' && <p className="muted">Must-haves first, then the most benefit for the least work. Switch to “Your ranking” to drag items.</p>}
      <ScoringHelp />
      {visible.length === 0 && <p className="empty">{board.items.length ? 'No items match these filters.' : 'This backlog is empty. Add the first item above.'}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ol className="rows">
            {visible.map((item, index) => (
              <Row key={item.id} ctx={ctx} item={item} position={index + 1} draggable={draggable} onTop={index > 0 && draggable ? () => moveToTop(item) : undefined} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </>
  );
}

function QuickAdd({ ctx }: { ctx: ProjectCtx }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ItemType>('story');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (await ctx.run(() => api('POST', `/projects/${ctx.board.project.id}/items`, { title, type }))) setTitle('');
  };
  return (
    <form className="toolbar" onSubmit={submit}>
      <select value={type} onChange={(e) => setType(e.target.value as ItemType)} aria-label="Type">
        {Object.entries(TYPE_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <input className="grow" placeholder="Add an item and press Enter" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      <button className="primary">Add</button>
    </form>
  );
}

function Row(props: { ctx: ProjectCtx; item: Item; position: number; draggable: boolean; onTop?: () => void }) {
  const { ctx, item } = props;
  const sortable = useSortable({ id: item.id, disabled: !props.draggable });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  const epic = ctx.board.epics.find((e) => e.id === item.epicId);
  const issues = ctx.issues.get(item.id) ?? [];
  const blockers = ctx.blockers.get(item.id) ?? [];
  const itemScore = score(item);
  const size = sizeOf(item.effort);
  const urgency = effectiveUrgency(item);

  return (
    <li ref={sortable.setNodeRef} style={style} className={`row ${item.status === 'done' ? 'done' : ''} ${sortable.isDragging ? 'dragging' : ''}`}>
      {props.draggable ? (
        <button className="handle" aria-label={`Reorder ${item.title}`} {...sortable.attributes} {...sortable.listeners}>
          ⠿
        </button>
      ) : (
        <span className="handle" />
      )}
      <span className="position">{props.position}</span>
      <MoscowChip moscow={item.moscow} />
      <span className={`chip type-${item.type}`}>{TYPE_LABEL[item.type]}</span>
      <button className="link title" onClick={() => ctx.open(item.id)}>
        <span className="muted">{ctx.itemKey(item)}</span> {item.title}
      </button>
      {blockers.length > 0 && (
        <span className="chip warn" title={`Blocked by ${blockers.map((b) => ctx.itemKey(b)).join(', ')}`}>
          Blocked
        </span>
      )}
      {issues.length > 0 && (
        <span className="chip warn" title={issues.map((i) => i.detail).join('\n')}>
          ⚠ {issues.length}
        </span>
      )}
      {epic && (
        <span className="chip" style={{ borderColor: epic.color, color: epic.color }}>
          {epic.title}
        </span>
      )}
      {urgency && urgency !== 'wait' && (
        <span className={`chip urgency-${urgency}`} title={item.dueDate ? `Due ${item.dueDate}` : 'Urgency'}>
          {URGENCY_LABEL[urgency]}
        </span>
      )}
      <span className="num" title={size ? `Size ${size.name}: ${size.about} (${item.effort} points)` : 'No size yet'}>
        {size?.name ?? '–'}
      </span>
      <span className="num" title="Suggested score: benefit (priority plus urgency) for the work involved. Higher is better.">
        {itemScore ?? '–'}
      </span>
      {ctx.canEdit ? (
        <select
          value={item.status}
          aria-label="Status"
          onChange={(e) => ctx.run(() => api('PATCH', `/items/${item.id}`, { status: e.target.value as ItemStatus }))}
        >
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      ) : (
        <span className="chip">{STATUS_LABEL[item.status]}</span>
      )}
      <button className="ghost" title="Move to top" aria-label="Move to top" onClick={props.onTop} style={{ visibility: props.onTop ? 'visible' : 'hidden' }}>
        ⤒
      </button>
    </li>
  );
}
