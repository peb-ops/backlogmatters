import type { Dependency, Issue, Item, Moscow, Release, Urgency } from './types';

export const STALE_DAYS = 30;
/** MoSCoW guideline: keep must-haves to about 60% of capacity so there is room for surprises. */
export const MUST_SHARE_LIMIT = 0.6;

export const MOSCOW: Moscow[] = ['must', 'should', 'could', 'wont'];
export const MOSCOW_LABEL: Record<Moscow, string> = { must: 'Must', should: 'Should', could: 'Could', wont: "Won't" };
export const MOSCOW_ABOUT: Record<Moscow, string> = {
  must: 'The release fails without it',
  should: 'Important, but there is a workaround',
  could: 'Nice to have if there is room',
  wont: 'Agreed to leave out this time',
};
const MOSCOW_WEIGHT: Record<Moscow, number> = { must: 8, should: 5, could: 2, wont: 0 };

export const URGENCIES: Urgency[] = ['wait', 'soon', 'now'];
export const URGENCY_LABEL: Record<Urgency, string> = { wait: 'Can wait', soon: 'Soon', now: 'Now' };
export const URGENCY_ABOUT: Record<Urgency, string> = {
  wait: 'Nothing is lost by waiting',
  soon: 'Waiting starts to cost us',
  now: 'It is already hurting us',
};
const URGENCY_WEIGHT: Record<Urgency, number> = { wait: 0, soon: 2, now: 4 };

export interface Size {
  name: string;
  points: number;
  about: string;
}
/** T-shirt sizes and the points each one stands for. */
export const SIZES: Size[] = [
  { name: 'XS', points: 1, about: 'A few hours for one person' },
  { name: 'S', points: 2, about: 'A day or two' },
  { name: 'M', points: 3, about: 'Most of a week' },
  { name: 'L', points: 5, about: 'A couple of weeks' },
  { name: 'XL', points: 8, about: 'A month or more; consider splitting it' },
];

/** The size whose points are closest from above, so imported estimates such as 13 points show as XL. */
export function sizeOf(points: number | null): Size | null {
  if (points == null) return null;
  return SIZES.find((s) => points <= s.points) ?? SIZES[SIZES.length - 1];
}

/** Urgency after taking the due date into account: within a week is "now", within a month is "soon". */
export function effectiveUrgency(item: Pick<Item, 'urgency' | 'dueDate'>, now = Date.now()): Urgency | null {
  let fromDate: Urgency | null = null;
  if (item.dueDate) {
    const days = Math.ceil((Date.parse(item.dueDate) - now) / 86_400_000);
    fromDate = days <= 7 ? 'now' : days <= 30 ? 'soon' : 'wait';
  }
  if (!item.urgency || !fromDate) return item.urgency ?? fromDate;
  return URGENCY_WEIGHT[fromDate] > URGENCY_WEIGHT[item.urgency] ? fromDate : item.urgency;
}

type Scored = Pick<Item, 'moscow' | 'urgency' | 'dueDate' | 'effort'>;

/**
 * Suggested score: benefit per unit of work, (MoSCoW weight + urgency weight) / points.
 * Null until a category and a size are set, and for won't-haves.
 */
export function score(item: Scored, now = Date.now()): number | null {
  if (item.moscow == null || item.moscow === 'wont' || item.effort == null || item.effort <= 0) return null;
  const urgency = effectiveUrgency(item, now);
  return Math.round(((MOSCOW_WEIGHT[item.moscow] + (urgency ? URGENCY_WEIGHT[urgency] : 0)) / item.effort) * 100) / 100;
}

/** Suggested order: must-haves first, then should, could, uncategorised and won't; best score first within each. */
export function bySuggestion(a: Scored, b: Scored, now = Date.now()): number {
  const group = (i: Scored) => (i.moscow == null ? 3 : i.moscow === 'wont' ? 4 : MOSCOW.indexOf(i.moscow));
  return group(a) - group(b) || (score(b, now) ?? -1) - (score(a, now) ?? -1);
}

function tokens(title: string): Set<string> {
  return new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

function similarTokens(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const jaccard = shared / (a.size + b.size - shared);
  return jaccard === 1 || (Math.min(a.size, b.size) >= 4 && jaccard >= 0.8);
}

export function similarTitles(a: string, b: string): boolean {
  return similarTokens(tokens(a), tokens(b));
}

/** True if making `blockerId` block `blockedId` would create a circular chain. */
export function wouldCreateCycle(deps: Dependency[], blockerId: number, blockedId: number): boolean {
  if (blockerId === blockedId) return true;
  const blocks = new Map<number, number[]>();
  for (const d of deps) blocks.set(d.blockerId, [...(blocks.get(d.blockerId) ?? []), d.blockedId]);
  const seen = new Set<number>();
  const stack = [blockedId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === blockerId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(blocks.get(id) ?? []));
  }
  return false;
}

/** Grooming and dependency problems for the open items of one project. */
export function computeIssues(
  items: Item[],
  deps: Dependency[],
  releases: Release[],
  now = Date.now(),
): Issue[] {
  const issues: Issue[] = [];
  const open = items.filter((i) => i.status !== 'done');

  const today = new Date(now).toISOString().slice(0, 10);
  for (const i of open) {
    // Won't-haves are parked on purpose, so they are not expected to be groomed.
    if (i.moscow === 'wont') continue;
    if (i.moscow == null) issues.push({ itemId: i.id, kind: 'no_moscow', detail: 'No MoSCoW category' });
    if (i.effort == null) issues.push({ itemId: i.id, kind: 'unestimated', detail: 'No size estimate' });
    if (i.type === 'story' && !i.acceptanceCriteria.trim())
      issues.push({ itemId: i.id, kind: 'missing_ac', detail: 'Story has no acceptance criteria' });
    if (i.type === 'story' && i.epicId == null)
      issues.push({ itemId: i.id, kind: 'no_epic', detail: 'Story is not in an epic' });
    const age = Math.floor((now - Date.parse(i.updatedAt)) / 86_400_000);
    if (age >= STALE_DAYS) issues.push({ itemId: i.id, kind: 'stale', detail: `Not updated for ${age} days` });
    if (i.dueDate && i.dueDate < today) issues.push({ itemId: i.id, kind: 'overdue', detail: `Was due on ${i.dueDate}` });
    if (i.moscow === 'must' && i.releaseId == null && releases.length > 0)
      issues.push({ itemId: i.id, kind: 'must_unscheduled', detail: 'Must-have that is not in any release' });
  }

  const toks = open.map((i) => tokens(i.title));
  const flagged = new Set<number>();
  for (let a = 0; a < open.length; a++) {
    for (let b = a + 1; b < open.length; b++) {
      if (!similarTokens(toks[a], toks[b])) continue;
      for (const [x, y] of [[a, b], [b, a]]) {
        if (flagged.has(open[x].id)) continue;
        flagged.add(open[x].id);
        issues.push({ itemId: open[x].id, kind: 'duplicate', detail: `Title is similar to #${open[y].number}` });
      }
    }
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const releaseById = new Map(releases.map((r) => [r.id, r]));
  for (const d of deps) {
    const blocker = byId.get(d.blockerId);
    const blocked = byId.get(d.blockedId);
    if (!blocker || !blocked || blocker.status === 'done' || blocked.status === 'done') continue;
    if (blocked.rank < blocker.rank)
      issues.push({ itemId: blocked.id, kind: 'dep_order', detail: `Ranked above #${blocker.number}, which blocks it` });
    const blockedRelease = blocked.releaseId == null ? undefined : releaseById.get(blocked.releaseId);
    if (!blockedRelease) continue;
    const blockerRelease = blocker.releaseId == null ? undefined : releaseById.get(blocker.releaseId);
    if (!blockerRelease) {
      issues.push({
        itemId: blocked.id,
        kind: 'dep_release',
        detail: `Scheduled in ${blockedRelease.name}, but blocker #${blocker.number} is not scheduled`,
      });
    } else if (
      blockerRelease.id !== blockedRelease.id &&
      blockerRelease.startDate &&
      blockedRelease.startDate &&
      blockerRelease.startDate > blockedRelease.startDate
    ) {
      issues.push({
        itemId: blocked.id,
        kind: 'dep_release',
        detail: `Scheduled in ${blockedRelease.name}, before blocker #${blocker.number} (${blockerRelease.name})`,
      });
    }
  }
  return issues;
}
