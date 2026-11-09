import type { Board, Issue, IssueKind, Item, ItemStatus, ItemType, User } from '../../shared/types';

/** Everything a project tab needs: the loaded data plus the actions shared by all tabs. */
export interface ProjectCtx {
  board: Board;
  user: User;
  /** Feature flag: whether sign-in and sharing between people are switched on. */
  accounts: boolean;
  canEdit: boolean;
  isOwner: boolean;
  issues: Map<number, Issue[]>;
  /** Unfinished items blocking each item. */
  blockers: Map<number, Item[]>;
  itemKey(item: Item): string;
  open(itemId: number): void;
  /** Runs a change, reloads the project, and reports any error. Resolves to whether it succeeded. */
  run(change: () => Promise<unknown>): Promise<boolean>;
}

export const STATUS_LABEL: Record<ItemStatus, string> = { new: 'New', ready: 'Ready', in_progress: 'In progress', done: 'Done' };
export const TYPE_LABEL: Record<ItemType, string> = { story: 'Story', task: 'Task', bug: 'Bug' };
export const ISSUE_LABEL: Record<IssueKind, string> = {
  no_moscow: 'No priority',
  must_unscheduled: 'Must-have not scheduled',
  overdue: 'Overdue',
  unestimated: 'No size',
  missing_ac: 'No acceptance criteria',
  no_epic: 'Not in an epic',
  stale: 'Stale',
  duplicate: 'Possible duplicate',
  dep_order: 'Ranked above its blocker',
  dep_release: 'Scheduled before its blocker',
};

export function indexBoard(board: Board) {
  const issues = new Map<number, Issue[]>();
  for (const issue of board.issues) issues.set(issue.itemId, [...(issues.get(issue.itemId) ?? []), issue]);
  const byId = new Map(board.items.map((i) => [i.id, i]));
  const blockers = new Map<number, Item[]>();
  for (const d of board.dependencies) {
    const blocker = byId.get(d.blockerId);
    if (blocker && blocker.status !== 'done') blockers.set(d.blockedId, [...(blockers.get(d.blockedId) ?? []), blocker]);
  }
  return { issues, blockers };
}

export const points = (items: Item[]) => items.reduce((sum, i) => sum + (i.effort ?? 0), 0);
