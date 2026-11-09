import { z } from 'zod';
import { MOSCOW_LABEL, SIZES, URGENCY_LABEL, sizeOf, wouldCreateCycle } from '../../shared/logic';
import type { Board, Dependency, ImportResult, ItemStatus, ItemType, Moscow, Urgency } from '../../shared/types';
import { HttpError } from './auth';
import type { Store } from './store';

// ---- CSV ----

export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// A leading apostrophe stops spreadsheet apps from running a cell as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    let s = v == null ? '' : String(v);
    if (typeof v === 'string' && FORMULA_START.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const unguard = (s: string) => (s.startsWith("'") && FORMULA_START.test(s.slice(1)) ? s.slice(1) : s);

// ---- export ----

export function exportCsv(board: Board): string {
  const epic = new Map(board.epics.map((e) => [e.id, e.title]));
  const release = new Map(board.releases.map((r) => [r.id, r.name]));
  const key = new Map(board.items.map((i) => [i.id, `${board.project.key}-${i.number}`]));
  const header = ['Key', 'Type', 'Title', 'Description', 'Acceptance Criteria', 'Status', 'Epic', 'Release', 'MoSCoW', 'Urgency', 'Due Date', 'Size', 'Effort', 'Blocked By'];
  const rows = board.items.map((i) => [
    key.get(i.id)!,
    i.type,
    i.title,
    i.description,
    i.acceptanceCriteria,
    i.status,
    i.epicId == null ? '' : epic.get(i.epicId) ?? '',
    i.releaseId == null ? '' : release.get(i.releaseId) ?? '',
    i.moscow && MOSCOW_LABEL[i.moscow],
    i.urgency && URGENCY_LABEL[i.urgency],
    i.dueDate,
    sizeOf(i.effort)?.name ?? null,
    i.effort,
    board.dependencies.filter((d) => d.blockedId === i.id).map((d) => key.get(d.blockerId)).join(' '),
  ]);
  return toCsv([header, ...rows]);
}

export function exportJson(board: Board) {
  const { project, epics, releases, items, dependencies } = board;
  return {
    format: 'backlogmatters' as const,
    version: 1,
    exportedAt: new Date().toISOString(),
    project: { key: project.key, name: project.name, description: project.description },
    epics,
    releases,
    items,
    dependencies,
  };
}

// ---- import ----

const COLUMNS: Record<string, string[]> = {
  key: ['key', 'issue key', 'id', 'issue id', 'card id'],
  type: ['type', 'issue type', 'issuetype'],
  title: ['title', 'summary', 'name', 'card name'],
  description: ['description', 'card description'],
  acceptanceCriteria: ['acceptance criteria', 'acceptance_criteria'],
  status: ['status', 'list name', 'list'],
  epic: ['epic', 'epic name', 'epic link', 'parent summary'],
  release: ['release', 'sprint', 'fix version', 'fix version/s', 'fix versions', 'iteration'],
  moscow: ['moscow', 'priority', 'value', 'business value'],
  urgency: ['urgency', 'time criticality'],
  dueDate: ['due date', 'due', 'duedate'],
  size: ['size', 't-shirt size'],
  effort: ['effort', 'points', 'story points', 'estimate'],
  blockedBy: ['blocked by', 'blocked_by'],
};

function toStatus(raw: string): ItemStatus {
  const s = raw.toLowerCase().replace(/[_-]/g, ' ').trim();
  if (/done|closed|resolved|complete/.test(s)) return 'done';
  if (/progress|doing|review|testing/.test(s)) return 'in_progress';
  if (/ready|selected|groomed|refined/.test(s)) return 'ready';
  return 'new';
}

function toType(raw: string): ItemType {
  const s = raw.toLowerCase();
  if (s.includes('bug') || s.includes('defect')) return 'bug';
  if (s.includes('task')) return 'task';
  return 'story';
}

function toNumber(raw: unknown, min: number, max: number): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

const numeric = (raw: unknown) => (typeof raw === 'number' || /^\d+(\.\d+)?$/.test(String(raw).trim()) ? Number(raw) : null);

/** Accepts MoSCoW words, Jira priority names, and the 1-10 values of older exports. */
export function toMoscow(raw: unknown): Moscow | null {
  if (raw == null || raw === '') return null;
  const n = numeric(raw);
  if (n != null) return n >= 8 ? 'must' : n >= 5 ? 'should' : n >= 2 ? 'could' : n >= 1 ? 'wont' : null;
  const s = String(raw).toLowerCase();
  if (/must|highest|critical|blocker/.test(s)) return 'must';
  if (/should|high/.test(s)) return 'should';
  if (/won|lowest/.test(s)) return 'wont';
  if (/could|medium|low/.test(s)) return 'could';
  return null;
}

export function toUrgency(raw: unknown): Urgency | null {
  if (raw == null || raw === '') return null;
  const n = numeric(raw);
  if (n != null) return n >= 8 ? 'now' : n >= 4 ? 'soon' : n >= 1 ? 'wait' : null;
  const s = String(raw).toLowerCase();
  if (/now|urgent|immediate|asap/.test(s)) return 'now';
  if (/soon/.test(s)) return 'soon';
  if (/wait|later|whenever/.test(s)) return 'wait';
  return null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (raw: unknown) => (typeof raw === 'string' && DATE.test(raw.trim()) ? raw.trim() : null);

/** Points from an explicit estimate, or failing that from a T-shirt size. */
function toEffort(points: unknown, size: unknown): number | null {
  const name = String(size ?? '').trim().toUpperCase();
  return toNumber(points, 0.01, 1000) ?? SIZES.find((s) => s.name === name)?.points ?? null;
}

/** Creates epics and releases by name on demand so imported rows can refer to ones that do not exist yet. */
class Importer {
  result: ImportResult = { items: 0, epics: 0, releases: 0, dependencies: 0, skipped: 0 };
  private epics: Map<string, number>;
  private releases: Map<string, number>;
  private deps: Dependency[];

  constructor(
    private store: Store,
    private projectId: number,
    private userId: number,
  ) {
    this.epics = new Map(store.listEpics(projectId).map((e) => [e.title.toLowerCase(), e.id]));
    this.releases = new Map(store.listReleases(projectId).map((r) => [r.name.toLowerCase(), r.id]));
    this.deps = store.listDependencies(projectId);
  }

  epic(title: string, extra: { description?: string; color?: string; done?: boolean } = {}): number | null {
    title = title.trim().slice(0, 200);
    if (!title) return null;
    let id = this.epics.get(title.toLowerCase());
    if (id == null) {
      id = this.store.createEpic(this.projectId, { title, ...extra });
      this.epics.set(title.toLowerCase(), id);
      this.result.epics++;
    }
    return id;
  }

  release(name: string, extra: Parameters<Store['createRelease']>[1] | {} = {}): number | null {
    name = name.trim().slice(0, 100);
    if (!name) return null;
    let id = this.releases.get(name.toLowerCase());
    if (id == null) {
      id = this.store.createRelease(this.projectId, { ...extra, name });
      this.releases.set(name.toLowerCase(), id);
      this.result.releases++;
    }
    return id;
  }

  item(data: Parameters<Store['createItem']>[1]): number {
    this.result.items++;
    return this.store.createItem(
      this.projectId,
      {
        ...data,
        title: data.title.slice(0, 200),
        description: data.description?.slice(0, 20000),
        acceptanceCriteria: data.acceptanceCriteria?.slice(0, 20000),
      },
      this.userId,
    );
  }

  dependency(blockerId: number | undefined, blockedId: number | undefined): void {
    if (blockerId == null || blockedId == null || wouldCreateCycle(this.deps, blockerId, blockedId)) return;
    this.store.addDependency(blockerId, blockedId);
    this.deps.push({ blockerId, blockedId });
    this.result.dependencies++;
  }
}

export function importCsv(store: Store, projectId: number, userId: number, content: string): ImportResult {
  const [header, ...rows] = parseCsv(content);
  if (!header) throw new HttpError(400, 'The file is empty');
  const names = header.map((h) => h.trim().toLowerCase());
  const index: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMNS)) index[field] = names.findIndex((n) => aliases.includes(n));
  if (index.title < 0) throw new HttpError(400, 'The file needs a "Title" or "Summary" column');

  return store.transaction(() => {
    const imp = new Importer(store, projectId, userId);
    const idByKey = new Map<string, number>();
    const blockedBy: [number, string][] = [];
    for (const row of rows) {
      const get = (field: string) => (index[field] < 0 ? '' : unguard((row[index[field]] ?? '').trim()));
      const title = get('title');
      if (!title) {
        imp.result.skipped++;
        continue;
      }
      if (get('type').toLowerCase() === 'epic') {
        imp.epic(title, { description: get('description').slice(0, 20000) });
        continue;
      }
      const id = imp.item({
        title,
        type: toType(get('type')),
        status: toStatus(get('status')),
        description: get('description'),
        acceptanceCriteria: get('acceptanceCriteria'),
        epicId: imp.epic(get('epic')),
        releaseId: imp.release(get('release')),
        moscow: toMoscow(get('moscow')),
        urgency: toUrgency(get('urgency')),
        dueDate: toDate(get('dueDate')),
        effort: toEffort(get('effort'), get('size')),
      });
      if (get('key')) idByKey.set(get('key').toLowerCase(), id);
      if (get('blockedBy')) blockedBy.push([id, get('blockedBy')]);
    }
    for (const [id, keys] of blockedBy)
      for (const key of keys.split(/[\s,;]+/).filter(Boolean)) imp.dependency(idByKey.get(key.toLowerCase()), id);
    return imp.result;
  });
}

const exportFile = z.object({
  format: z.literal('backlogmatters'),
  epics: z
    .array(z.object({ id: z.number(), title: z.string(), description: z.string().optional(), color: z.string().optional(), done: z.boolean().optional() }))
    .default([]),
  releases: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        startDate: z.string().nullish(),
        endDate: z.string().nullish(),
        capacity: z.number().nullish(),
        status: z.string().optional(),
      }),
    )
    .default([]),
  items: z
    .array(
      z.object({
        id: z.number(),
        title: z.string(),
        type: z.string().optional(),
        status: z.string().optional(),
        description: z.string().optional(),
        acceptanceCriteria: z.string().optional(),
        epicId: z.number().nullish(),
        releaseId: z.number().nullish(),
        moscow: z.string().nullish(),
        // Exports made before MoSCoW carried a numeric value and urgency.
        value: z.number().nullish(),
        urgency: z.union([z.string(), z.number()]).nullish(),
        dueDate: z.string().nullish(),
        effort: z.number().nullish(),
        rank: z.number().optional(),
      }),
    )
    .default([]),
  dependencies: z.array(z.object({ blockerId: z.number(), blockedId: z.number() })).default([]),
});

const COLOR = /^#[0-9a-f]{6}$/i;

export function importJson(store: Store, projectId: number, userId: number, content: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new HttpError(400, 'The file is not valid JSON');
  }
  const parsed = exportFile.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'This is not a BacklogMatters export file');
  const file = parsed.data;

  return store.transaction(() => {
    const imp = new Importer(store, projectId, userId);
    const epicIds = new Map<number, number | null>();
    for (const e of file.epics)
      epicIds.set(e.id, imp.epic(e.title, { description: e.description?.slice(0, 20000), color: COLOR.test(e.color ?? '') ? e.color : undefined, done: e.done }));
    const releaseIds = new Map<number, number | null>();
    for (const r of file.releases)
      releaseIds.set(
        r.id,
        imp.release(r.name, {
          startDate: toDate(r.startDate),
          endDate: toDate(r.endDate),
          capacity: toNumber(r.capacity, 0, 100000),
          status: r.status === 'active' || r.status === 'done' ? r.status : 'planned',
        }),
      );
    const itemIds = new Map<number, number>();
    for (const i of [...file.items].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))) {
      if (!i.title.trim()) {
        imp.result.skipped++;
        continue;
      }
      itemIds.set(
        i.id,
        imp.item({
          title: i.title.trim(),
          type: toType(i.type ?? ''),
          status: toStatus(i.status ?? ''),
          description: i.description,
          acceptanceCriteria: i.acceptanceCriteria,
          epicId: i.epicId == null ? null : epicIds.get(i.epicId) ?? null,
          releaseId: i.releaseId == null ? null : releaseIds.get(i.releaseId) ?? null,
          moscow: toMoscow(i.moscow ?? i.value),
          urgency: toUrgency(i.urgency),
          dueDate: toDate(i.dueDate),
          effort: toNumber(i.effort, 0.01, 1000),
        }),
      );
    }
    for (const d of file.dependencies) imp.dependency(itemIds.get(d.blockerId), itemIds.get(d.blockedId));
    return imp.result;
  });
}
