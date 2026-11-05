import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed, DEMO_PASSWORD } from '../src/seed.js';
import { pool } from '../src/db.js';

const app = createApp();
const api = request(app);
const tokens = {};
let me = {};

const login = async (email) => {
  const r = await api.post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  assert.equal(r.status, 200);
  return r.body;
};
const as = (who) => ({ Authorization: `Bearer ${tokens[who]}` });

before(async () => {
  await seed();
  for (const who of ['lead', 'asha', 'ravi', 'meera', 'kabir']) {
    const r = await login(`${who}@foreman.dev`);
    tokens[who] = r.token;
    me[who] = r.user;
  }
});
after(() => pool.end());

test('login rejects bad credentials and unknown users the same way', async () => {
  const a = await api.post('/api/auth/login').send({ email: 'lead@foreman.dev', password: 'nope-nope1' });
  const b = await api.post('/api/auth/login').send({ email: 'ghost@foreman.dev', password: 'nope-nope1' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.error.message, b.body.error.message);
  const bad = await api.post('/api/auth/login').send({ email: 'not-an-email' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
});

test('protected routes need a valid token', async () => {
  assert.equal((await api.get('/api/projects')).status, 401);
  assert.equal((await api.get('/api/projects').set('Authorization', 'Bearer garbage')).status, 401);
});

test('developers only see projects they belong to; leads see all', async () => {
  const lead = await api.get('/api/projects').set(as('lead'));
  const asha = await api.get('/api/projects').set(as('asha'));
  const kabir = await api.get('/api/projects').set(as('kabir'));
  assert.equal(lead.body.items.length, 5);
  assert.deepEqual(asha.body.items.map((p) => p.code).sort(), ['MOB', 'SFR', 'VOP']);
  assert.deepEqual(kabir.body.items.map((p) => p.code).sort(), ['ANL', 'MOB', 'PAY']);
});

test('developers cannot create projects, tasks or users', async () => {
  const p = await api.post('/api/projects').set(as('asha')).send({ code: 'ZZZ', name: 'Nope', startDate: '2026-01-01', dueDate: '2026-02-01' });
  assert.equal(p.status, 403);
  const { body } = await api.get('/api/projects').set(as('lead'));
  const sfr = body.items.find((x) => x.code === 'SFR');
  const t = await api.post(`/api/projects/${sfr.id}/tasks`).set(as('asha')).send({ title: 'Sneaky task' });
  assert.equal(t.status, 403);
  const u = await api.post('/api/users').set(as('asha')).send({ name: 'X Y', email: 'x@y.dev', password: 'Passw0rdx' });
  assert.equal(u.status, 403);
});

test('a developer cannot read a task from a project they are not in', async () => {
  const pay = (await api.get('/api/tasks?project=PAY').set(as('lead'))).body.items[0];
  const r = await api.get(`/api/tasks/${pay.id}`).set(as('asha'));
  assert.equal(r.status, 404);
});

test('lead creates a project and task with validation', async () => {
  const bad = await api.post('/api/projects').set(as('lead')).send({ code: 'x', name: 'a', startDate: '2026-03-01', dueDate: '2026-02-01' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.details.code);
  assert.ok(bad.body.error.details.name);

  const ok = await api.post('/api/projects').set(as('lead')).send({
    code: 'tst', name: 'Test Project', startDate: '2026-01-01', dueDate: '2026-12-31', memberIds: [me.asha.id],
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.project.code, 'TST');
  const dup = await api.post('/api/projects').set(as('lead')).send({ code: 'TST', name: 'Dup Project', startDate: '2026-01-01', dueDate: '2026-12-31' });
  assert.equal(dup.status, 409);

  const pid = ok.body.project.id;
  const outside = await api.post(`/api/projects/${pid}/tasks`).set(as('lead')).send({ title: 'Too late', dueDate: '2027-06-01' });
  assert.equal(outside.status, 400);
  const t = await api.post(`/api/projects/${pid}/tasks`).set(as('lead')).send({ title: 'First task', priority: 'high', assigneeId: me.ravi.id, dueDate: '2026-06-01', effort: 5 });
  assert.equal(t.status, 201);
  assert.equal(t.body.task.key, 'TST-1');
  assert.equal(t.body.task.assigneeName, 'Ravi Patel');

  // assignee was auto-added to the project, so Ravi can now see it
  const seen = await api.get(`/api/tasks/${t.body.task.id}`).set(as('ravi'));
  assert.equal(seen.status, 200);

  const badEffort = await api.post(`/api/projects/${pid}/tasks`).set(as('lead')).send({ title: 'Huge task', effort: 99 });
  assert.equal(badEffort.status, 400);

  const del = await api.delete(`/api/projects/${pid}`).set(as('lead'));
  assert.equal(del.status, 409); // has tasks
});

test('task lifecycle through the review gate', async () => {
  const list = await api.get('/api/tasks?project=SFR&assignee=asha-none').set(as('lead'));
  assert.equal(list.status, 400); // assignee must be a uuid, "me" or "unassigned"
  const todo = (await api.get('/api/tasks?project=SFR&status=todo').set(as('lead'))).body.items.find((t) => t.assigneeId === me.asha.id);
  assert.ok(todo);

  // Kabir is not in SFR and Ravi is not the assignee
  assert.equal((await api.post(`/api/tasks/${todo.id}/transition`).set(as('kabir')).send({ to: 'in_progress' })).status, 404);
  assert.equal((await api.post(`/api/tasks/${todo.id}/transition`).set(as('ravi')).send({ to: 'in_progress' })).status, 403);

  // skipping a step is refused
  assert.equal((await api.post(`/api/tasks/${todo.id}/transition`).set(as('asha')).send({ to: 'under_review' })).status, 409);

  let r = await api.post(`/api/tasks/${todo.id}/transition`).set(as('asha')).send({ to: 'in_progress' });
  assert.equal(r.status, 200);
  assert.equal(r.body.task.status, 'in_progress');

  r = await api.post(`/api/tasks/${todo.id}/progress`).set(as('asha')).send({ progress: 95 });
  assert.equal(r.status, 400);
  r = await api.post(`/api/tasks/${todo.id}/progress`).set(as('asha')).send({ progress: 70, note: 'Halfway there' });
  assert.equal(r.body.task.progress, 70);

  r = await api.post(`/api/tasks/${todo.id}/block`).set(as('asha')).send({ blocked: true });
  assert.equal(r.status, 400); // reason required
  r = await api.post(`/api/tasks/${todo.id}/block`).set(as('asha')).send({ blocked: true, reason: 'Need API key' });
  assert.equal(r.body.task.blocked, true);
  r = await api.post(`/api/tasks/${todo.id}/transition`).set(as('asha')).send({ to: 'under_review' });
  assert.equal(r.status, 409); // blocker must be cleared
  await api.post(`/api/tasks/${todo.id}/block`).set(as('asha')).send({ blocked: false });

  r = await api.post(`/api/tasks/${todo.id}/transition`).set(as('asha')).send({ to: 'under_review' });
  assert.equal(r.body.task.progress, 95);
  // developer cannot self-approve
  assert.equal((await api.post(`/api/tasks/${todo.id}/transition`).set(as('asha')).send({ to: 'completed' })).status, 403);
  // lead must explain a send-back
  assert.equal((await api.post(`/api/tasks/${todo.id}/transition`).set(as('lead')).send({ to: 'in_progress' })).status, 409);
  r = await api.post(`/api/tasks/${todo.id}/transition`).set(as('lead')).send({ to: 'in_progress', note: 'Please add tests' });
  assert.equal(r.body.task.status, 'in_progress');
  await api.post(`/api/tasks/${todo.id}/transition`).set(as('asha')).send({ to: 'under_review' });
  r = await api.post(`/api/tasks/${todo.id}/transition`).set(as('lead')).send({ to: 'completed', note: 'Approved' });
  assert.equal(r.body.task.status, 'completed');
  assert.equal(r.body.task.progress, 100);
  assert.ok(r.body.task.completedAt);

  // the ledger recorded every step, newest first
  const kinds = r.body.updates.map((u) => u.kind);
  assert.ok(kinds.includes('progress') && kinds.includes('block') && kinds.includes('status'));
  assert.equal(r.body.updates[0].toStatus, 'completed');

  // developer posts a note on own task but not someone else's
  const mine = (await api.get('/api/tasks?assignee=me&status=in_progress').set(as('asha'))).body.items[0];
  assert.equal((await api.post(`/api/tasks/${mine.id}/updates`).set(as('asha')).send({ body: 'Pairing with Meera tomorrow' })).status, 201);
  assert.equal((await api.post(`/api/tasks/${mine.id}/updates`).set(as('asha')).send({ body: '   ' })).status, 400);
  const theirs = (await api.get('/api/tasks?project=SFR&assignee=' + me.meera.id).set(as('asha'))).body.items[0];
  assert.equal((await api.post(`/api/tasks/${theirs.id}/updates`).set(as('asha')).send({ body: 'hello' })).status, 403);
});

test('filters: status, priority, overdue, blocked, search, unassigned', async () => {
  const lead = (q) => api.get(`/api/tasks?${q}`).set(as('lead'));
  const overdue = await lead('overdue=true');
  assert.ok(overdue.body.items.length > 0 && overdue.body.items.every((t) => t.overdue));
  const blocked = await lead('blocked=true');
  assert.ok(blocked.body.items.every((t) => t.blocked));
  const high = await lead('priority=high&project=PAY');
  assert.ok(high.body.items.every((t) => t.priority === 'high' && t.projectCode === 'PAY'));
  const search = await lead('q=webhook');
  assert.equal(search.body.items[0].key, 'PAY-3');
  const none = await lead('assignee=unassigned&status=todo');
  assert.ok(none.body.items.every((t) => t.assigneeId === null));
  assert.equal((await lead('status=bogus')).status, 400);
});

test('dashboard: team numbers for leads, personal numbers for developers', async () => {
  const l = (await api.get('/api/dashboard').set(as('lead'))).body;
  assert.equal(l.scope, 'team');
  assert.ok(l.totals.activeProjects >= 3);
  assert.equal(l.totals.assignedTasks, l.totals.completed + l.totals.pending);
  assert.ok(l.workload.length >= 4);
  assert.ok(l.brief.length > 0);
  const d = (await api.get('/api/dashboard').set(as('kabir'))).body;
  assert.equal(d.scope, 'personal');
  assert.equal(d.workload.length, 0);
  assert.ok(d.totals.assignedTasks < l.totals.assignedTasks);
  assert.ok(d.projects.every((p) => ['PAY', 'MOB', 'ANL'].includes(p.code)));
});

test('dashboard reacts to changes', async () => {
  const totals = async () => (await api.get('/api/dashboard').set(as('lead'))).body.totals;
  const before = await totals();
  const mob = (await api.get('/api/projects').set(as('lead'))).body.items.find((p) => p.code === 'MOB');
  const yesterday = new Date(Date.now() - 86_400_000 * 1.5).toISOString().slice(0, 10);
  const t = await api.post(`/api/projects/${mob.id}/tasks`).set(as('lead')).send({ title: 'Late by design', assigneeId: me.kabir.id, dueDate: yesterday });
  assert.equal(t.status, 201);
  const after = await totals();
  assert.equal(after.assignedTasks, before.assignedTasks + 1);
  assert.equal(after.pending, before.pending + 1);
  assert.equal(after.overdue, before.overdue + 1);
  // a due date outside the project window is refused
  const bad = await api.patch(`/api/tasks/${t.body.task.id}`).set(as('lead')).send({ dueDate: '2000-01-01' });
  assert.equal(bad.status, 400);
  await api.delete(`/api/tasks/${t.body.task.id}`).set(as('lead'));
  assert.deepEqual(await totals(), before);
});

test('lead cannot be locked out and users with open work cannot be deactivated', async () => {
  const last = await api.patch(`/api/users/${me.lead.id}`).set(as('lead')).send({ active: false });
  assert.equal(last.status, 409);
  const busy = await api.patch(`/api/users/${me.ravi.id}`).set(as('lead')).send({ active: false });
  assert.equal(busy.status, 409);
  const weak = await api.post('/api/users').set(as('lead')).send({ name: 'New Dev', email: 'new@foreman.dev', password: 'short' });
  assert.equal(weak.status, 400);
  const ok = await api.post('/api/users').set(as('lead')).send({ name: 'New Dev', email: 'NEW@foreman.dev', password: 'Welcome123' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.user.email, 'new@foreman.dev');
  assert.equal((await api.post('/api/users').set(as('lead')).send({ name: 'New Dev', email: 'new@foreman.dev', password: 'Welcome123' })).status, 409);
  assert.equal(ok.body.user.passwordHash, undefined);
});

test('unknown endpoints and malformed JSON return clean errors', async () => {
  assert.equal((await api.get('/api/nope').set(as('lead'))).status, 404);
  const bad = await api.post('/api/auth/login').set('content-type', 'application/json').send('{oops');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'BAD_JSON');
  assert.equal((await api.get('/api/tasks/not-a-uuid').set(as('lead'))).status, 404);
});
