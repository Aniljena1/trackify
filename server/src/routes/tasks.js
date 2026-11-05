import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { today } from '../config.js';
import { requireLead } from '../middleware/auth.js';
import { parse, notFound, conflict, forbidden, badRequest } from '../lib/errors.js';
import { TASK_SELECT, taskDto, visibleProjectsClause, addUpdate, ensureMember } from '../lib/data.js';
import { planTransition, taskActions, STATUSES, PRIORITIES } from '../lib/rules.js';

export const tasksRouter = Router();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Not a real date');
const uuid = z.string().uuid('Invalid id');

const createSchema = z.object({
  title: z.string().trim().min(3, 'Title is too short').max(140),
  description: z.string().trim().max(4000).default(''),
  priority: z.enum(PRIORITIES).default('medium'),
  assigneeId: uuid.nullable().default(null),
  dueDate: date.nullable().default(null),
  effort: z.number().int().min(1, 'Effort is 1-13 points').max(13, 'Effort is 1-13 points').default(3),
});

const patchSchema = z
  .object({
    title: createSchema.shape.title,
    description: createSchema.shape.description,
    priority: createSchema.shape.priority,
    assigneeId: uuid.nullable(),
    dueDate: date.nullable(),
    effort: createSchema.shape.effort,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const listSchema = z.object({
  project: z.string().optional(), // uuid or project code
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee: z.union([z.literal('me'), z.literal('unassigned'), uuid]).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  blocked: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['priority', 'due', 'updated']).default('priority'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

async function loadTask(db, id, user, { lock = false } = {}) {
  const params = [id];
  const visible = visibleProjectsClause(user, params);
  // FOR UPDATE cannot be applied across an outer join, so lock the bare row first.
  if (lock) await db.query('SELECT 1 FROM tasks WHERE id = $1 FOR UPDATE', [id]);
  const { rows } = await db.query(`${TASK_SELECT} WHERE t.id = $1 AND ${visible}`, params);
  if (!rows[0]) throw notFound('Task');
  return taskDto(rows[0], today());
}

async function respond(res, user, id, status = 200) {
  const task = await loadTask({ query }, id, user);
  const { rows } = await query(
    `SELECT tu.id, tu.kind, tu.body, tu.from_status, tu.to_status, tu.progress, tu.created_at, u.id AS author_id, u.name AS author_name
       FROM task_updates tu LEFT JOIN users u ON u.id = tu.author_id
      WHERE tu.task_id = $1 ORDER BY tu.created_at DESC, tu.id`,
    [id],
  );
  res.status(status).json({
    task,
    actions: taskActions(task, user),
    updates: rows.map((r) => ({
      id: r.id, kind: r.kind, body: r.body, fromStatus: r.from_status, toStatus: r.to_status,
      progress: r.progress, createdAt: r.created_at, authorId: r.author_id, authorName: r.author_name,
    })),
  });
}

async function assertAssignable(db, projectId, assigneeId) {
  if (!assigneeId) return;
  const { rows } = await db.query('SELECT id FROM users WHERE id = $1 AND active', [assigneeId]);
  if (!rows[0]) throw badRequest('Assignee does not exist or is inactive', { assigneeId: 'Unknown person' });
  await ensureMember(db, projectId, assigneeId);
}

function assertDueInWindow(project, dueDate) {
  if (!dueDate) return;
  if (dueDate < project.start_date || dueDate > project.due_date) {
    throw badRequest(`Due date must fall inside the project window (${project.start_date} to ${project.due_date})`, {
      dueDate: 'Outside project window',
    });
  }
}

/* ---------- list ---------- */
tasksRouter.get('/tasks', async (req, res) => {
  const f = parse(listSchema, req.query);
  const asOf = today();
  const params = [];
  const where = [visibleProjectsClause(req.user, params)];
  const p = (v) => (params.push(v), `$${params.length}`);

  if (f.project) where.push(/^[0-9a-f-]{36}$/i.test(f.project) ? `t.project_id = ${p(f.project)}` : `p.code = ${p(f.project.toUpperCase())}`);
  if (f.status) where.push(`t.status = ${p(f.status)}`);
  if (f.priority) where.push(`t.priority = ${p(f.priority)}`);
  if (f.assignee === 'unassigned') where.push('t.assignee_id IS NULL');
  else if (f.assignee) where.push(`t.assignee_id = ${p(f.assignee === 'me' ? req.user.id : f.assignee)}`);
  if (f.overdue === 'true') where.push(`(t.due_date < ${p(asOf)}::date AND t.status <> 'completed')`);
  if (f.blocked === 'true') where.push(`(t.blocked AND t.status <> 'completed')`);
  if (f.q) where.push(`(t.title ILIKE ${p(`%${f.q.replace(/[%_\\]/g, '\\$&')}%`)} OR (p.code || '-' || t.seq) ILIKE ${p(`${f.q}%`)})`);

  const order = {
    priority: `(t.status = 'completed'), CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.due_date NULLS LAST, t.seq`,
    due: `(t.status = 'completed'), t.due_date NULLS LAST, t.seq`,
    updated: 't.updated_at DESC',
  }[f.sort];

  const whereSql = where.join(' AND ');
  const [{ rows }, { rows: count }] = await Promise.all([
    query(`${TASK_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ${f.limit} OFFSET ${f.offset}`, params),
    query(`SELECT count(*)::int AS n FROM tasks t JOIN projects p ON p.id = t.project_id WHERE ${whereSql}`, params),
  ]);
  res.json({ items: rows.map((r) => taskDto(r, asOf)), total: count[0].n });
});

/* ---------- create (lead) ---------- */
tasksRouter.post('/projects/:projectId/tasks', requireLead, async (req, res) => {
  const body = parse(createSchema, req.body);
  const id = await tx(async (c) => {
    const { rows } = await c.query(
      'UPDATE projects SET task_seq = task_seq + 1 WHERE id = $1 RETURNING id, start_date, due_date, status, task_seq',
      [req.params.projectId],
    );
    const project = rows[0];
    if (!project) throw notFound('Project');
    if (project.status === 'completed') throw conflict('This project is completed. Reopen it before adding tasks.');
    assertDueInWindow(project, body.dueDate);
    await assertAssignable(c, project.id, body.assigneeId);

    const { rows: [t] } = await c.query(
      `INSERT INTO tasks (project_id, seq, title, description, priority, assignee_id, created_by, due_date, effort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [project.id, project.task_seq, body.title, body.description, body.priority, body.assigneeId, req.user.id, body.dueDate, body.effort],
    );
    await addUpdate(c, {
      taskId: t.id, authorId: req.user.id, kind: 'assign',
      body: body.assigneeId ? 'Task created and assigned' : 'Task created',
    });
    return t.id;
  });
  await respond(res, req.user, id, 201);
});

/* ---------- read ---------- */
tasksRouter.get('/tasks/:id', async (req, res) => {
  await respond(res, req.user, req.params.id);
});

/* ---------- edit fields (lead) ---------- */
tasksRouter.patch('/tasks/:id', requireLead, async (req, res) => {
  const body = parse(patchSchema, req.body);
  await tx(async (c) => {
    const task = await loadTask(c, req.params.id, req.user, { lock: true });
    const { rows: [project] } = await c.query('SELECT * FROM projects WHERE id = $1', [task.projectId]);

    if ('dueDate' in body) assertDueInWindow(project, body.dueDate);
    if ('assigneeId' in body && body.assigneeId !== task.assigneeId) {
      if (!body.assigneeId && task.status !== 'todo' && task.status !== 'completed') {
        throw conflict('Move the task back to To Do before removing its assignee');
      }
      await assertAssignable(c, task.projectId, body.assigneeId);
    }

    const cols = { title: 'title', description: 'description', priority: 'priority', assigneeId: 'assignee_id', dueDate: 'due_date', effort: 'effort' };
    const sets = [];
    const params = [];
    for (const [k, col] of Object.entries(cols)) {
      if (k in body) {
        params.push(body[k]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    params.push(task.id);
    await c.query(`UPDATE tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);

    if ('assigneeId' in body && body.assigneeId !== task.assigneeId) {
      let who = 'Unassigned';
      if (body.assigneeId) {
        const { rows } = await c.query('SELECT name FROM users WHERE id = $1', [body.assigneeId]);
        who = `Assigned to ${rows[0].name}`;
      }
      await addUpdate(c, { taskId: task.id, authorId: req.user.id, kind: 'assign', body: who });
    }
  });
  await respond(res, req.user, req.params.id);
});

/* ---------- delete (lead) ---------- */
tasksRouter.delete('/tasks/:id', requireLead, async (req, res) => {
  const result = await query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) throw notFound('Task');
  res.status(204).end();
});

/* ---------- status transition ---------- */
const transitionSchema = z.object({ to: z.enum(STATUSES), note: z.string().trim().max(1000).optional() });

tasksRouter.post('/tasks/:id/transition', async (req, res) => {
  const { to, note } = parse(transitionSchema, req.body);
  await tx(async (c) => {
    const task = await loadTask(c, req.params.id, req.user, { lock: true });
    const patch = planTransition({ task, to, actor: req.user, note });
    await c.query(
      `UPDATE tasks SET status = $1, progress = $2, updated_at = now(),
              completed_at = CASE WHEN $3::boolean THEN now() WHEN $4::boolean THEN NULL ELSE completed_at END
        WHERE id = $5`,
      [patch.status, patch.progress, patch.completedAt === true, patch.completedAt === false, task.id],
    );
    await addUpdate(c, {
      taskId: task.id, authorId: req.user.id, kind: 'status', body: note ?? '',
      fromStatus: task.status, toStatus: to, progress: patch.progress,
    });
  });
  await respond(res, req.user, req.params.id);
});

/* ---------- progress report ---------- */
const progressSchema = z.object({
  progress: z.number().int().min(0, 'Progress is 0-90').max(90, 'Progress is 0-90. Submit for review to go further.'),
  note: z.string().trim().max(1000).optional(),
});

tasksRouter.post('/tasks/:id/progress', async (req, res) => {
  const { progress, note } = parse(progressSchema, req.body);
  await tx(async (c) => {
    const task = await loadTask(c, req.params.id, req.user, { lock: true });
    if (req.user.role !== 'lead' && task.assigneeId !== req.user.id) throw forbidden('Only the assignee or a lead can report progress');
    if (task.status !== 'in_progress') throw conflict('Progress can only be reported while a task is In Progress');
    await c.query('UPDATE tasks SET progress = $1, updated_at = now() WHERE id = $2', [progress, task.id]);
    await addUpdate(c, { taskId: task.id, authorId: req.user.id, kind: 'progress', body: note ?? '', progress });
  });
  await respond(res, req.user, req.params.id);
});

/* ---------- free-form update ---------- */
tasksRouter.post('/tasks/:id/updates', async (req, res) => {
  const { body } = parse(z.object({ body: z.string().trim().min(1, 'Write something first').max(2000) }), req.body);
  await tx(async (c) => {
    const task = await loadTask(c, req.params.id, req.user);
    if (req.user.role !== 'lead' && task.assigneeId !== req.user.id) throw forbidden('Only the assignee or a lead can post updates');
    await addUpdate(c, { taskId: task.id, authorId: req.user.id, kind: 'note', body });
    await c.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [task.id]);
  });
  await respond(res, req.user, req.params.id, 201);
});

/* ---------- blocker flag ---------- */
const blockSchema = z
  .object({ blocked: z.boolean(), reason: z.string().trim().max(500).optional() })
  .refine((v) => !v.blocked || (v.reason && v.reason.length > 0), { message: 'Say what is blocking this task', path: ['reason'] });

tasksRouter.post('/tasks/:id/block', async (req, res) => {
  const { blocked, reason } = parse(blockSchema, req.body);
  await tx(async (c) => {
    const task = await loadTask(c, req.params.id, req.user, { lock: true });
    if (req.user.role !== 'lead' && task.assigneeId !== req.user.id) throw forbidden('Only the assignee or a lead can flag a blocker');
    if (task.status === 'completed') throw conflict('Completed tasks cannot be blocked');
    if (task.blocked === blocked) throw conflict(blocked ? 'Task is already blocked' : 'Task is not blocked');
    await c.query('UPDATE tasks SET blocked = $1, blocked_reason = $2, updated_at = now() WHERE id = $3', [blocked, blocked ? reason : null, task.id]);
    await addUpdate(c, { taskId: task.id, authorId: req.user.id, kind: 'block', body: blocked ? reason : 'Blocker cleared' });
  });
  await respond(res, req.user, req.params.id);
});
