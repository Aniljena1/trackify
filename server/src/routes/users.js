import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { requireLead } from '../middleware/auth.js';
import { parse, conflict, notFound } from '../lib/errors.js';
import { userDto, TASK_SELECT, taskDto } from '../lib/data.js';
import { workload } from '../lib/metrics.js';
import { today } from '../config.js';
import { passwordRule } from './auth.js';

export const usersRouter = Router();

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: passwordRule,
  role: z.enum(['lead', 'developer']).default('developer'),
  title: z.string().trim().max(80).default(''),
  weeklyCapacity: z.number().int().min(1).max(100).default(20),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    title: z.string().trim().max(80),
    role: z.enum(['lead', 'developer']),
    weeklyCapacity: z.number().int().min(1).max(100),
    active: z.boolean(),
    password: passwordRule,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** Leads get the full directory with live load; developers get a minimal list for @-mentions and filters. */
usersRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM users ${req.user.role === 'lead' ? '' : 'WHERE active'} ORDER BY active DESC, role, name`,
  );
  const users = rows.map(userDto);
  if (req.user.role !== 'lead') {
    return res.json({ items: users.map(({ id, name, role, title }) => ({ id, name, role, title })) });
  }

  const asOf = today();
  const { rows: taskRows } = await query(`${TASK_SELECT} WHERE t.assignee_id IS NOT NULL AND t.status <> 'completed'`);
  const open = taskRows.map((r) => taskDto(r, asOf));
  res.json({
    items: users.map((u) => ({
      ...u,
      workload: workload(open.filter((t) => t.assigneeId === u.id), u.weeklyCapacity, asOf),
    })),
  });
});

usersRouter.post('/', requireLead, async (req, res) => {
  const body = parse(createSchema, req.body);
  const hash = await bcrypt.hash(body.password, 10);
  try {
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, role, title, weekly_capacity)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [body.name, body.email, hash, body.role, body.title, body.weeklyCapacity],
    );
    res.status(201).json({ user: userDto(rows[0]) });
  } catch (e) {
    if (e.code === '23505') throw conflict('A user with that email already exists', { email: 'Already registered' });
    throw e;
  }
});

usersRouter.patch('/:id', requireLead, async (req, res) => {
  const body = parse(updateSchema, req.body);
  const { rows: existing } = await query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!existing[0]) throw notFound('User');

  const demoting = (body.role && body.role !== 'lead') || body.active === false;
  if (existing[0].role === 'lead' && demoting) {
    const { rows } = await query(`SELECT count(*)::int AS n FROM users WHERE role = 'lead' AND active AND id <> $1`, [req.params.id]);
    if (rows[0].n === 0) throw conflict('There must always be at least one active team lead');
  }
  if (body.active === false) {
    const { rows } = await query(`SELECT count(*)::int AS n FROM tasks WHERE assignee_id = $1 AND status <> 'completed'`, [req.params.id]);
    if (rows[0].n > 0) throw conflict(`Reassign their ${rows[0].n} open task(s) before deactivating this person`);
  }

  const sets = [];
  const params = [];
  const add = (col, val) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (body.name !== undefined) add('name', body.name);
  if (body.title !== undefined) add('title', body.title);
  if (body.role !== undefined) add('role', body.role);
  if (body.weeklyCapacity !== undefined) add('weekly_capacity', body.weeklyCapacity);
  if (body.active !== undefined) add('active', body.active);
  if (body.password !== undefined) add('password_hash', await bcrypt.hash(body.password, 10));
  params.push(req.params.id);
  const { rows } = await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  res.json({ user: userDto(rows[0]) });
});
