import type { Request, Router } from 'express';
import { z } from 'zod';
import { wouldCreateCycle } from '../../../shared/logic';
import type { Access, Project } from '../../../shared/types';
import { HttpError, requireAccounts, requireUser } from '../auth';
import type { Store } from '../store';
import { exportCsv, exportJson, importCsv, importJson } from '../transfer';

const text = z.string().max(20000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

const projectFields = z.object({
  name: z.string().trim().min(1).max(100),
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,5}$/, 'Use 2 to 6 letters or numbers, starting with a letter'),
  description: z.string().max(2000),
});
const projectPatch = projectFields.omit({ key: true }).extend({ archived: z.boolean(), ownerId: z.number().int() }).partial();

const epicFields = z.object({
  title: z.string().trim().min(1).max(200),
  description: text,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  done: z.boolean(),
});

const releaseFields = z.object({
  name: z.string().trim().min(1).max(100),
  startDate: date,
  endDate: date,
  capacity: z.number().min(0).max(100000).nullable(),
  status: z.enum(['planned', 'active', 'done']),
});

const itemFields = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(['story', 'task', 'bug']),
  status: z.enum(['new', 'ready', 'in_progress', 'done']),
  description: text,
  acceptanceCriteria: text,
  epicId: z.number().int().nullable(),
  releaseId: z.number().int().nullable(),
  moscow: z.enum(['must', 'should', 'could', 'wont']).nullable(),
  urgency: z.enum(['wait', 'soon', 'now']).nullable(),
  dueDate: date,
  effort: z.number().positive().max(1000).nullable(),
});

const LEVEL: Record<Access, number> = { viewer: 0, editor: 1, owner: 2 };

function param(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n)) throw new HttpError(404, 'Not found');
  return n;
}

export function projectRoutes(r: Router, store: Store, accounts: boolean): void {
  r.use(requireUser);
  r.use('/projects/:id/members', requireAccounts(accounts));

  // Projects the user cannot see are reported as missing rather than forbidden.
  function project(req: Request, projectId: number | undefined, need: Access = 'viewer'): Project {
    const p = projectId == null ? undefined : store.getProject(req.user!, projectId);
    if (!p) throw new HttpError(404, 'Not found');
    if (LEVEL[p.access] < LEVEL[need]) throw new HttpError(403, 'You do not have permission to do that');
    return p;
  }

  function checkLinks(p: Project, data: { epicId?: number | null; releaseId?: number | null }): void {
    if (data.epicId != null && store.getEpic(data.epicId)?.projectId !== p.id) throw new HttpError(400, 'That epic is not in this project');
    if (data.releaseId != null && store.getRelease(data.releaseId)?.projectId !== p.id) throw new HttpError(400, 'That release is not in this project');
  }

  // ---- projects ----

  r.get('/projects', (req, res) => res.json(store.listProjects(req.user!)));

  r.post('/projects', (req, res) => {
    if (req.user!.role === 'viewer') throw new HttpError(403, 'You do not have permission to do that');
    const data = projectFields.partial({ description: true }).parse(req.body);
    if (store.keyTaken(data.key)) throw new HttpError(409, `The key ${data.key} is already used by another project`);
    const id = store.createProject({ ...data, ownerId: req.user!.id });
    res.status(201).json(store.getProject(req.user!, id));
  });

  r.get('/projects/:id/board', (req, res) => res.json(store.board(project(req, param(req)))));

  r.patch('/projects/:id', (req, res) => {
    const p = project(req, param(req), 'owner');
    const patch = projectPatch.parse(req.body);
    if (patch.ownerId != null) {
      const owner = store.getUser(patch.ownerId);
      if (!owner || owner.disabled || owner.role === 'viewer') throw new HttpError(400, 'The new owner must be an active manager or administrator');
    }
    store.updateProject(p.id, patch);
    res.json(store.getProject(req.user!, p.id) ?? null);
  });

  r.delete('/projects/:id', (req, res) => {
    store.deleteProject(project(req, param(req), 'owner').id);
    res.status(204).end();
  });

  r.put('/projects/:id/members/:userId', (req, res) => {
    const p = project(req, param(req), 'owner');
    const { role } = z.object({ role: z.enum(['editor', 'viewer']) }).parse(req.body);
    const user = store.getUser(param(req, 'userId'));
    if (!user || user.disabled) throw new HttpError(404, 'User not found');
    if (user.id === p.ownerId) throw new HttpError(400, 'The owner already has full access');
    store.setMember(p.id, user.id, role);
    res.status(204).end();
  });

  r.delete('/projects/:id/members/:userId', (req, res) => {
    store.removeMember(project(req, param(req), 'owner').id, param(req, 'userId'));
    res.status(204).end();
  });

  // ---- epics ----

  r.post('/projects/:id/epics', (req, res) => {
    const p = project(req, param(req), 'editor');
    const data = epicFields.partial().required({ title: true }).parse(req.body);
    res.status(201).json(store.getEpic(store.createEpic(p.id, data)));
  });

  r.patch('/epics/:id', (req, res) => {
    const epic = store.getEpic(param(req));
    project(req, epic?.projectId, 'editor');
    store.updateEpic(epic!.id, epicFields.partial().parse(req.body));
    res.json(store.getEpic(epic!.id));
  });

  r.delete('/epics/:id', (req, res) => {
    const epic = store.getEpic(param(req));
    project(req, epic?.projectId, 'editor');
    store.deleteEpic(epic!.id);
    res.status(204).end();
  });

  // ---- releases ----

  r.post('/projects/:id/releases', (req, res) => {
    const p = project(req, param(req), 'editor');
    const data = releaseFields.partial().required({ name: true }).parse(req.body);
    res.status(201).json(store.getRelease(store.createRelease(p.id, data)));
  });

  r.patch('/releases/:id', (req, res) => {
    const release = store.getRelease(param(req));
    project(req, release?.projectId, 'editor');
    store.updateRelease(release!.id, releaseFields.partial().parse(req.body));
    res.json(store.getRelease(release!.id));
  });

  r.delete('/releases/:id', (req, res) => {
    const release = store.getRelease(param(req));
    project(req, release?.projectId, 'editor');
    store.deleteRelease(release!.id);
    res.status(204).end();
  });

  // ---- items ----

  r.post('/projects/:id/items', (req, res) => {
    const p = project(req, param(req), 'editor');
    const data = itemFields.partial().required({ title: true }).parse(req.body);
    checkLinks(p, data);
    res.status(201).json(store.getItem(store.createItem(p.id, data, req.user!.id)));
  });

  r.patch('/items/:id', (req, res) => {
    const item = store.getItem(param(req));
    const p = project(req, item?.projectId, 'editor');
    const patch = itemFields.partial().parse(req.body);
    checkLinks(p, patch);
    store.updateItem(item!.id, patch);
    res.json(store.getItem(item!.id));
  });

  r.delete('/items/:id', (req, res) => {
    const item = store.getItem(param(req));
    project(req, item?.projectId, 'editor');
    store.deleteItem(item!.id);
    res.status(204).end();
  });

  r.put('/projects/:id/rank', (req, res) => {
    const p = project(req, param(req), 'editor');
    const { itemIds } = z.object({ itemIds: z.array(z.number().int()).max(100000) }).parse(req.body);
    store.reorder(p.id, itemIds);
    res.status(204).end();
  });

  // ---- dependencies ----

  r.post('/items/:id/dependencies', (req, res) => {
    const blocked = store.getItem(param(req));
    const p = project(req, blocked?.projectId, 'editor');
    const { blockerId } = z.object({ blockerId: z.number().int() }).parse(req.body);
    if (store.getItem(blockerId)?.projectId !== p.id) throw new HttpError(400, 'Both items must be in the same project');
    if (wouldCreateCycle(store.listDependencies(p.id), blockerId, blocked!.id))
      throw new HttpError(400, 'That would make the items block each other in a circle');
    store.addDependency(blockerId, blocked!.id);
    res.status(204).end();
  });

  r.delete('/items/:id/dependencies/:blockerId', (req, res) => {
    const blocked = store.getItem(param(req));
    project(req, blocked?.projectId, 'editor');
    store.removeDependency(param(req, 'blockerId'), blocked!.id);
    res.status(204).end();
  });

  // ---- import / export ----

  r.get('/projects/:id/export', (req, res) => {
    const board = store.board(project(req, param(req)));
    const csv = req.query.format === 'csv';
    res.setHeader('Content-Disposition', `attachment; filename="${board.project.key}-backlog.${csv ? 'csv' : 'json'}"`);
    if (csv) res.type('text/csv').send('﻿' + exportCsv(board));
    else res.json(exportJson(board));
  });

  r.post('/projects/:id/import', (req, res) => {
    const p = project(req, param(req), 'editor');
    const { format, content } = z.object({ format: z.enum(['csv', 'json']), content: z.string() }).parse(req.body);
    res.json((format === 'csv' ? importCsv : importJson)(store, p.id, req.user!.id, content));
  });
}
