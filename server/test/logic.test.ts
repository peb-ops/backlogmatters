import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { bySuggestion, computeIssues, effectiveUrgency, score, similarTitles, sizeOf, wouldCreateCycle } from '../../shared/logic';
import type { Item, Release } from '../../shared/types';
import { migrate } from '../src/db';
import { parseCsv, toCsv, toMoscow, toUrgency } from '../src/transfer';

const NOW = Date.parse('2026-10-05T00:00:00Z');

function item(over: Partial<Item>): Item {
  return {
    id: 1, projectId: 1, number: 1, epicId: 1, releaseId: null, type: 'story', title: 'Item', description: '',
    acceptanceCriteria: 'Given, when, then', status: 'new', moscow: 'should', urgency: 'wait', dueDate: null, effort: 2, rank: 0,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...over,
  };
}

const kinds = (items: Item[], deps = [] as { blockerId: number; blockedId: number }[], releases: Release[] = []) =>
  computeIssues(items, deps, releases, NOW).map((i) => `${i.itemId}:${i.kind}`);

describe('score', () => {
  const of = (moscow: Item['moscow'], urgency: Item['urgency'], effort: number | null, dueDate: string | null = null) =>
    score({ moscow, urgency, effort, dueDate }, NOW);

  it('divides the MoSCoW and urgency weights by the points', () => {
    expect(of('must', 'now', 3)).toBe(4);
    expect(of('should', null, 2)).toBe(2.5);
    expect(of('could', 'soon', 8)).toBe(0.5);
  });
  it('is null without a category or a size, and for won’t-haves', () => {
    expect(of(null, 'now', 3)).toBeNull();
    expect(of('must', 'now', null)).toBeNull();
    expect(of('wont', 'now', 1)).toBeNull();
  });
  it('lets a close due date raise urgency but never lower it', () => {
    expect(effectiveUrgency({ urgency: 'wait', dueDate: '2026-10-09' }, NOW)).toBe('now');
    expect(effectiveUrgency({ urgency: null, dueDate: '2026-10-25' }, NOW)).toBe('soon');
    expect(effectiveUrgency({ urgency: 'now', dueDate: '2027-06-01' }, NOW)).toBe('now');
    expect(effectiveUrgency({ urgency: null, dueDate: null }, NOW)).toBeNull();
    expect(of('must', 'wait', 4, '2026-10-01')).toBe(3);
  });
});

describe('suggested order', () => {
  it('puts must-haves first, then the best score, with uncategorised and won’t-haves last', () => {
    const items = [
      { id: 'wont', moscow: 'wont', urgency: 'now', effort: 1, dueDate: null },
      { id: 'none', moscow: null, urgency: 'now', effort: 1, dueDate: null },
      { id: 'could-quick', moscow: 'could', urgency: 'now', effort: 1, dueDate: null },
      { id: 'must-big', moscow: 'must', urgency: null, effort: 8, dueDate: null },
      { id: 'must-quick', moscow: 'must', urgency: null, effort: 1, dueDate: null },
    ] as const;
    expect([...items].sort((a, b) => bySuggestion(a, b, NOW)).map((i) => i.id)).toEqual(['must-quick', 'must-big', 'could-quick', 'none', 'wont']);
  });
});

describe('sizes', () => {
  it('shows points as the nearest size at or above them', () => {
    expect([1, 2, 3, 4, 5, 8, 13].map((p) => sizeOf(p)!.name)).toEqual(['XS', 'S', 'M', 'L', 'L', 'XL', 'XL']);
    expect(sizeOf(null)).toBeNull();
  });
});

describe('import conversions', () => {
  it('reads MoSCoW words, Jira priorities and old 1-10 values', () => {
    expect(['Must have', "Won't", 'Could', 'Highest', 'High', 'Low', 'Lowest', '9', '5', '1', 'banana', ''].map(toMoscow)).toEqual([
      'must', 'wont', 'could', 'must', 'should', 'could', 'wont', 'must', 'should', 'wont', null, null,
    ]);
  });
  it('reads urgency words and old 1-10 values', () => {
    expect(['Now', 'Soon', 'Can wait', '9', '5', '2', ''].map(toUrgency)).toEqual(['now', 'soon', 'wait', 'now', 'soon', 'wait', null]);
  });
});

describe('similarTitles', () => {
  it('ignores case, punctuation and word order', () => {
    expect(similarTitles('Reset password', 'password: RESET!')).toBe(true);
  });
  it('allows one differing word only in longer titles', () => {
    expect(similarTitles('Export the backlog to a CSV file', 'Export the backlog to CSV file')).toBe(true);
    expect(similarTitles('Export backlog', 'Import backlog')).toBe(false);
  });
});

describe('wouldCreateCycle', () => {
  const deps = [{ blockerId: 1, blockedId: 2 }, { blockerId: 2, blockedId: 3 }];
  it('rejects self, direct and indirect loops', () => {
    expect(wouldCreateCycle(deps, 1, 1)).toBe(true);
    expect(wouldCreateCycle(deps, 2, 1)).toBe(true);
    expect(wouldCreateCycle(deps, 3, 1)).toBe(true);
  });
  it('accepts a new forward link', () => {
    expect(wouldCreateCycle(deps, 1, 3)).toBe(false);
    expect(wouldCreateCycle(deps, 3, 4)).toBe(false);
  });
});

describe('computeIssues', () => {
  it('reports nothing for a well-groomed item', () => {
    expect(kinds([item({})])).toEqual([]);
  });
  it('flags missing estimate, acceptance criteria and epic', () => {
    expect(kinds([item({ effort: null, acceptanceCriteria: ' ', epicId: null })])).toEqual(['1:unestimated', '1:missing_ac', '1:no_epic']);
  });
  it('only expects acceptance criteria and an epic on stories', () => {
    expect(kinds([item({ type: 'bug', acceptanceCriteria: '', epicId: null })])).toEqual([]);
  });
  it('flags stale items but ignores done ones', () => {
    expect(kinds([item({ updatedAt: '2026-08-01T00:00:00Z' })])).toEqual(['1:stale']);
    expect(kinds([item({ updatedAt: '2026-08-01T00:00:00Z', status: 'done', effort: null })])).toEqual([]);
  });
  it('flags a missing category, a passed due date and an unscheduled must-have', () => {
    const release: Release = { id: 1, projectId: 1, name: 'R1', startDate: null, endDate: null, capacity: null, status: 'planned' };
    expect(kinds([item({ moscow: null })])).toEqual(['1:no_moscow']);
    expect(kinds([item({ dueDate: '2026-10-04' })])).toEqual(['1:overdue']);
    expect(kinds([item({ dueDate: '2026-10-05' })])).toEqual([]);
    expect(kinds([item({ moscow: 'must' })], [], [release])).toEqual(['1:must_unscheduled']);
    expect(kinds([item({ moscow: 'must' })])).toEqual([]);
    expect(kinds([item({ moscow: 'must', releaseId: 1 })], [], [release])).toEqual([]);
  });
  it('does not expect won’t-haves to be groomed', () => {
    expect(kinds([item({ moscow: 'wont', effort: null, acceptanceCriteria: '', epicId: null, updatedAt: '2026-01-01T00:00:00Z' })])).toEqual([]);
  });
  it('flags both items of a duplicate pair', () => {
    expect(kinds([item({ title: 'Reset password' }), item({ id: 2, number: 2, title: 'reset  Password' })])).toEqual(['1:duplicate', '2:duplicate']);
  });
  it('flags an item ranked above its open blocker', () => {
    const items = [item({ id: 1, number: 1, title: 'A', rank: 0 }), item({ id: 2, number: 2, title: 'B', rank: 1 })];
    expect(kinds(items, [{ blockerId: 2, blockedId: 1 }])).toEqual(['1:dep_order']);
    expect(kinds(items, [{ blockerId: 1, blockedId: 2 }])).toEqual([]);
    items[1].status = 'done';
    expect(kinds(items, [{ blockerId: 2, blockedId: 1 }])).toEqual([]);
  });
  it('flags an item scheduled before its blocker', () => {
    const releases: Release[] = [
      { id: 1, projectId: 1, name: 'R1', startDate: '2026-10-01', endDate: null, capacity: null, status: 'planned' },
      { id: 2, projectId: 1, name: 'R2', startDate: '2026-11-01', endDate: null, capacity: null, status: 'planned' },
    ];
    const blocker = item({ id: 1, number: 1, title: 'A', rank: 0 });
    const blocked = item({ id: 2, number: 2, title: 'B', rank: 1, releaseId: 1 });
    const dep = [{ blockerId: 1, blockedId: 2 }];
    expect(kinds([blocker, blocked], dep, releases)).toEqual(['2:dep_release']);
    blocker.releaseId = 2;
    expect(kinds([blocker, blocked], dep, releases)).toEqual(['2:dep_release']);
    blocker.releaseId = 1;
    expect(kinds([blocker, blocked], dep, releases)).toEqual([]);
  });
});

describe('database migration to MoSCoW', () => {
  it('converts numeric value and urgency and keeps everything else', () => {
    const db = new Database(':memory:');
    migrate(db, 1);
    db.exec(`
      INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (1, 'a', 'A', 'x', 'admin', 't');
      INSERT INTO projects (id, key, name, owner_id, created_at) VALUES (1, 'P', 'P', 1, 't');
      INSERT INTO items (project_id, number, title, value, urgency, effort, rank, created_at, updated_at) VALUES
        (1, 1, 'High', 9, 9, 3, 0, 't', 't'), (1, 2, 'Mid', 6, 5, 2, 1, 't', 't'),
        (1, 3, 'Low', 2, 1, 1, 2, 't', 't'), (1, 4, 'Blank', NULL, NULL, NULL, 3, 't', 't');
    `);
    migrate(db);
    const rows = db.prepare('SELECT title, moscow, urgency, due_date, effort FROM items ORDER BY number').all();
    expect(rows).toEqual([
      { title: 'High', moscow: 'must', urgency: 'now', due_date: null, effort: 3 },
      { title: 'Mid', moscow: 'should', urgency: 'soon', due_date: null, effort: 2 },
      { title: 'Low', moscow: 'could', urgency: 'wait', due_date: null, effort: 1 },
      { title: 'Blank', moscow: null, urgency: null, due_date: null, effort: null },
    ]);
  });
});

describe('csv', () => {
  it('round-trips quotes, commas and line breaks', () => {
    const rows = [['Title', 'Notes'], ['Say "hi", twice', 'line one\nline two']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it('handles a byte order mark, CRLF and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('neutralises spreadsheet formulas on export', () => {
    expect(toCsv([['=SUM(A1)', 5]])).toBe("'=SUM(A1),5\r\n");
  });
});
