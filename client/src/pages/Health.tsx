import { STALE_DAYS } from '../../../shared/logic';
import type { IssueKind } from '../../../shared/types';
import { ISSUE_LABEL, type ProjectCtx } from '../board';

const HELP: Record<IssueKind, string> = {
  no_moscow: 'Open items that have not been given a Must, Should, Could or Won’t category.',
  must_unscheduled: 'Must-haves that are not in any release. If the release fails without them, they need a place in the plan.',
  overdue: 'Open items whose due date has passed.',
  unestimated: 'Open items without a size cannot be planned against capacity.',
  missing_ac: 'Stories without acceptance criteria are not ready to be picked up.',
  no_epic: 'Stories that do not belong to an epic.',
  stale: `Open items nobody has updated in ${STALE_DAYS} days or more. Refresh them or remove them.`,
  duplicate: 'Open items with nearly identical titles.',
  dep_order: 'Items ranked above something that blocks them.',
  dep_release: 'Items scheduled in a release before the item that blocks them.',
};

export function Health({ ctx }: { ctx: ProjectCtx }) {
  const { board } = ctx;
  const kinds = (Object.keys(ISSUE_LABEL) as IssueKind[]).filter((k) => board.issues.some((i) => i.kind === k));
  const open = board.items.filter((i) => i.status !== 'done').length;

  if (kinds.length === 0)
    return <p className="empty">{open ? `All ${open} open items are in good shape.` : 'There are no open items to check.'}</p>;

  return (
    <>
      <p className="muted">
        {ctx.issues.size} of {open} open items need attention.
      </p>
      {kinds.map((kind) => {
        const issues = board.issues.filter((i) => i.kind === kind);
        return (
          <section key={kind} className="card">
            <header>
              <h2>{ISSUE_LABEL[kind]}</h2>
              <span className="chip warn">{issues.length}</span>
            </header>
            <p className="muted">{HELP[kind]}</p>
            <ul className="plain">
              {issues.map((issue) => {
                const item = board.items.find((i) => i.id === issue.itemId)!;
                return (
                  <li key={issue.itemId + issue.detail}>
                    <button className="link title" onClick={() => ctx.open(item.id)}>
                      <span className="muted">{ctx.itemKey(item)}</span> {item.title}
                    </button>
                    <span className="muted">{issue.detail}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
