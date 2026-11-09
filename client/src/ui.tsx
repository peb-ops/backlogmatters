import { useEffect, type ReactNode } from 'react';
import { MOSCOW, MOSCOW_ABOUT, MOSCOW_LABEL, MUST_SHARE_LIMIT, SIZES, URGENCIES, URGENCY_ABOUT, URGENCY_LABEL } from '../../shared/logic';
import type { Moscow } from '../../shared/types';

export function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={props.title}>
        <header>
          <h2>{props.title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {props.children}
      </div>
    </div>
  );
}

export function Field(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}

export interface ChoiceOption<T> {
  value: T;
  label: string;
  about: string;
  className?: string;
}

/** A row of described cards to pick one from. Picking the selected card again clears the choice. */
export function Choice<T extends string | number>(props: {
  label: string;
  value: T | null;
  options: ChoiceOption<T>[];
  onChange: (value: T | null) => void;
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={props.label}>
      <span className="choice-label">{props.label}</span>
      <div className="choice-options">
        {props.options.map((o) => {
          const selected = props.value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`${o.className ?? ''} ${selected ? 'selected' : ''}`}
              onClick={() => props.onChange(selected ? null : o.value)}
            >
              <strong>{o.label}</strong>
              <small>{o.about}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MoscowChip({ moscow }: { moscow: Moscow | null }) {
  return moscow ? (
    <span className={`chip moscow-${moscow}`} title={MOSCOW_ABOUT[moscow]}>
      {MOSCOW_LABEL[moscow]}
    </span>
  ) : (
    <span className="chip muted" title="No MoSCoW category yet">
      –
    </span>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;
}

export function ScoringHelp() {
  return (
    <details className="help">
      <summary>How priority, urgency, size and the suggested order work</summary>
      <dl>
        <dt>Priority (MoSCoW)</dt>
        {MOSCOW.map((m) => (
          <dd key={m}>
            <MoscowChip moscow={m} /> {MOSCOW_ABOUT[m]}.
          </dd>
        ))}
        <dd>
          If everything is a Must, nothing is. Keep must-haves to about {MUST_SHARE_LIMIT * 100}% of a release’s capacity so there is room
          for surprises; the Plan tab warns when a release goes over.
        </dd>
        <dt>Urgency</dt>
        <dd>
          What waiting costs: {URGENCIES.map((u) => `${URGENCY_LABEL[u]} (${URGENCY_ABOUT[u].toLowerCase()})`).join(', ')}. If you set a due
          date, urgency rises on its own: “Soon” within a month and “Now” within a week.
        </dd>
        <dt>Size</dt>
        <dd>
          How big the work is compared with other items, as a T-shirt size: {SIZES.map((s) => `${s.name} = ${s.points}`).join(', ')} points.
          Sizes are a comparison, not a promise of hours. The Plan tab adds the points up against each release’s capacity.
        </dd>
        <dt>Suggested order</dt>
        <dd>
          Must-haves first, then Should, then Could. Within each group, urgent and small items come first: the score is the benefit (priority
          plus urgency) divided by the size, so a higher score means more benefit for less work.
        </dd>
      </dl>
      <p>The suggested order is only advice. The order you drag items into on the Backlog tab is the real priority.</p>
    </details>
  );
}

/** Empty input means "not set". */
export const toNumber = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
