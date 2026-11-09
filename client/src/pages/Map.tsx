import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { MOSCOW, MOSCOW_ABOUT, MOSCOW_LABEL, SIZES, sizeOf } from '../../../shared/logic';
import type { Item, Moscow } from '../../../shared/types';
import { api } from '../api';
import type { ProjectCtx } from '../board';

// Releasing a dragged item also fires a click on it; this lets the click handler ignore that one.
let lastDragEnd = 0;

/** What a cell of the map means for planning, from its priority row and size column. */
function zone(moscow: Moscow, sizeIndex: number): { name: string; className: string } {
  if (moscow === 'wont') return { name: 'Parked', className: 'zone-parked' };
  const small = sizeIndex <= 1;
  const large = sizeIndex >= 3;
  if (moscow === 'could') return large ? { name: 'Reconsider', className: 'zone-avoid' } : { name: 'Fill-in', className: 'zone-fill' };
  if (small) return { name: 'Quick win', className: 'zone-quick' };
  if (large) return { name: 'Big bet', className: 'zone-bet' };
  return { name: 'Core work', className: 'zone-core' };
}

export function PriorityMap({ ctx }: { ctx: ProjectCtx }) {
  const { board, canEdit } = ctx;
  const open = board.items.filter((i) => i.status !== 'done');
  const unplaced = open.filter((i) => i.moscow == null || i.effort == null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragEnd({ active, over }: DragEndEvent) {
    lastDragEnd = Date.now();
    if (!over) return;
    const [moscow, points] = String(over.id).split(':');
    const item = board.items.find((i) => i.id === active.id);
    if (!item || (item.moscow === moscow && sizeOf(item.effort)?.points === Number(points))) return;
    ctx.run(() => api('PATCH', `/items/${item.id}`, { moscow, effort: Number(points) }));
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd} onDragCancel={() => (lastDragEnd = Date.now())}>
      <p className="muted">
        Each open item sits where its priority meets its size. {canEdit && 'Drag an item to another square to change both at once. '}
        Top left is where to start: needed most, done fastest.
      </p>
      <div className="legend">
        <span className="zone-quick">Quick win: needed and small</span>
        <span className="zone-core">Core work: needed and medium-sized</span>
        <span className="zone-bet">Big bet: needed but large, plan it carefully</span>
        <span className="zone-fill">Fill-in: optional and small</span>
        <span className="zone-avoid">Reconsider: optional and large</span>
      </div>
      {unplaced.length > 0 && (
        <section className="card tray">
          <h2>Not placed yet ({unplaced.length})</h2>
          <p className="muted">These need a priority, a size, or both. Drag each one onto the map.</p>
          <div className="pills">
            {unplaced.map((item) => (
              <Pill key={item.id} ctx={ctx} item={item} />
            ))}
          </div>
        </section>
      )}
      <div className="map" style={{ gridTemplateColumns: `110px repeat(${SIZES.length}, minmax(130px, 1fr))` }}>
        <div />
        {SIZES.map((s) => (
          <div key={s.name} className="map-head" title={s.about}>
            <strong>{s.name}</strong>
            <small>{s.about}</small>
          </div>
        ))}
        {MOSCOW.map((moscow) => (
          <Row key={moscow} ctx={ctx} moscow={moscow} items={open.filter((i) => i.moscow === moscow && i.effort != null)} />
        ))}
      </div>
    </DndContext>
  );
}

function Row({ ctx, moscow, items }: { ctx: ProjectCtx; moscow: Moscow; items: Item[] }) {
  return (
    <>
      <div className={`map-side moscow-${moscow}`} title={MOSCOW_ABOUT[moscow]}>
        <strong>{MOSCOW_LABEL[moscow]}</strong>
        <small>{MOSCOW_ABOUT[moscow]}</small>
      </div>
      {SIZES.map((size, index) => (
        <Cell key={size.name} ctx={ctx} id={`${moscow}:${size.points}`} zone={zone(moscow, index)} items={items.filter((i) => sizeOf(i.effort) === size)} />
      ))}
    </>
  );
}

function Cell(props: { ctx: ProjectCtx; id: string; zone: { name: string; className: string }; items: Item[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id, disabled: !props.ctx.canEdit });
  return (
    <div ref={setNodeRef} className={`map-cell ${props.zone.className} ${isOver ? 'over' : ''}`}>
      {props.zone.name && <span className="zone-name">{props.zone.name}</span>}
      <div className="pills">
        {props.items.map((item) => (
          <Pill key={item.id} ctx={props.ctx} item={item} />
        ))}
      </div>
    </div>
  );
}

function Pill({ ctx, item }: { ctx: ProjectCtx; item: Item }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id: item.id, disabled: !ctx.canEdit });
  return (
    <button
      ref={setNodeRef}
      className={`pill ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform) }}
      title={item.title}
      onClick={() => Date.now() - lastDragEnd > 250 && ctx.open(item.id)}
      {...attributes}
      {...listeners}
    >
      <span className="muted">{ctx.itemKey(item)}</span> {item.title}
    </button>
  );
}
