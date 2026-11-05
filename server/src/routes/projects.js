import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { today } from '../config.js';
import { requireLead } from '../middleware/auth.js';
import { parse, notFound, conflict, badRequest } from '../lib/errors.js';
import { loadProjectsWithStats } from '../lib/data.js';

export const projectsRouter = Router();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Not a real date');

const base = {
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, 'Use 2-5 letters, e.g. SFR'),
  name: z.string().trim().min(3, 'Name is too short').max(100),
  description: z.string().trim().max(2000).default(''),
  status: z.enum(['planning', 'active', 'on_hold', 'completed']).default('active'),
  startDate: date,
  dueDate: date,
  memberIds: z.array(z.string().uuid()).default([]),
};

const createSchema = z.object(base).refine((v) => v.dueDate >= v.startDate, {
  message: 'Due date cannot be before the start date',
  path: ['dueDate'],
});

const updateSchema = z
  .object({
    name: base.name,
    description: base.description,
    status: base.status,
    startDate: base.startDate,
    dueDate: base.dueDate,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

projectsRouter.get('/', async (req, res) => {
  let items = await loadProjectsWithStats(req.user, today());
  if (req.query.status) items = items.filter((p) => p.status === req.query.status);
  res.json({ items });
});

projectsRouter.get('/:id', async (req, res) => {
  const [project] = await loadProjectsWithStats(req.user, today(), { projectId: req.params.id });
  if (!project) throw notFound('Project');
  res.json({ project });
});

projectsRouter.post('/', requireLead, async (req, res) => {
  const body = parse(createSchema, req.body);
  const id = await tx(async (c) => {
    const { rows: people } = await c.query('SELECT id FROM users WHERE id = ANY($1::uuid[]) AND active', [body.memberIds]);
    if (people.length !== new Set(body.memberIds).size) throw badRequest('Some members do not exist or are inactive', { memberIds: 'Unknown member' });
    let created;
    try {
      ({ rows: [created] } = await c.query(
        `INSERT INTO projects (code, name, description, status, start_date, due_date, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [body.code, body.name, body.description, body.status, body.startDate, body.dueDate, req.user.id],
      ));
    } catch (e) {
      if (e.code === '23505') throw conflict(`Project code ${body.code} is taken`, { code: 'Already in use' });
      throw e;
    }
    for (const uid of new Set([...body.memberIds, req.user.id])) {
      await c.query('INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)', [created.id, uid]);
    }
    return created.id;
  });
  const [project] = await loadProjectsWithStats(req.user, today(), { projectId: id });
  res.status(201).json({ project });
});

projectsRouter.patch('/:id', requireLead, async (req, res) => {
  const body = parse(updateSchema, req.body);
  const { rows } = await query('SELECT * FROM projects WHERE id = $1', [req.params.id]);
  const current = rows[0];
  if (!current) throw notFound('Project');

  const start = body.startDate ?? current.start_date;
  const due = body.dueDate ?? current.due_date;
  if (due < start) throw badRequest('Due date cannot be before the start date', { dueDate: 'Before start date' });

  if (body.dueDate && body.dueDate < current.due_date) {
    const { rows: late } = await query(
      `SELECT count(*)::int AS n FROM tasks WHERE project_id = $1 AND due_date > $2`,
      [req.params.id, body.dueDate],
    );
    if (late[0].n > 0) throw conflict(`${late[0].n} task(s) are due after that date. Move them first.`, { dueDate: 'Tasks due later' });
  }
  if (body.status === 'completed') {
    const { rows: open } = await query(`SELECT count(*)::int AS n FROM tasks WHERE project_id = $1 AND status <> 'completed'`, [req.params.id]);
    if (open[0].n > 0) throw conflict(`${open[0].n} task(s) are still open. Finish them or use "on hold".`, { status: 'Open tasks remain' });
  }

  const map = { name: 'name', description: 'description', status: 'status', startDate: 'start_date', dueDate: 'due_date' };
  const sets = [];
  const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (body[k] !== undefined) {
      params.push(body[k]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  params.push(req.params.id);
  await query(`UPDATE projects SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
  const [project] = await loadProjectsWithStats(req.user, today(), { projectId: req.params.id });
  res.json({ project });
});

projectsRouter.put('/:id/members', requireLead, async (req, res) => {
  const { memberIds } = parse(z.object({ memberIds: z.array(z.string().uuid()) }), req.body);
  await tx(async (c) => {
    const { rows } = await c.query('SELECT id, owner_id FROM projects WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!rows[0]) throw notFound('Project');
    const keep = new Set(memberIds);
    if (rows[0].owner_id) keep.add(rows[0].owner_id);

    const { rows: blocking } = await c.query(
      `SELECT DISTINCT u.name FROM tasks t JOIN users u ON u.id = t.assignee_id
        WHERE t.project_id = $1 AND t.status <> 'completed' AND NOT (t.assignee_id = ANY($2::uuid[]))`,
      [req.params.id, [...keep]],
    );
    if (blocking.length) throw conflict(`Reassign open tasks first: ${blocking.map((b) => b.name).join(', ')}`);

    const { rows: valid } = await c.query('SELECT id FROM users WHERE id = ANY($1::uuid[]) AND active', [[...keep]]);
    if (valid.length !== keep.size) throw badRequest('Some members do not exist or are inactive', { memberIds: 'Unknown member' });

    await c.query('DELETE FROM project_members WHERE project_id = $1', [req.params.id]);
    for (const uid of keep) await c.query('INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)', [req.params.id, uid]);
  });
  const [project] = await loadProjectsWithStats(req.user, today(), { projectId: req.params.id });
  res.json({ project });
});

projectsRouter.delete('/:id', requireLead, async (req, res) => {
  const { rows } = await query('SELECT count(*)::int AS n FROM tasks WHERE project_id = $1', [req.params.id]);
  if (rows[0].n > 0) throw conflict('This project has tasks. Put it on hold or mark it completed instead of deleting.');
  const result = await query('DELETE FROM projects WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) throw notFound('Project');
  res.status(204).end();
});
