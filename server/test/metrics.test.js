import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectProgress, projectHealth, forecastFinish, workload, plannedProgress } from '../src/lib/metrics.js';
import { planTransition } from '../src/lib/rules.js';

const project = { startDate: '2026-01-01', dueDate: '2026-01-31', status: 'active' };
const task = (o) => ({ status: 'todo', progress: 0, effort: 2, dueDate: '2026-01-20', blocked: false, ...o });

test('progress is effort-weighted and caps in-progress at 90%', () => {
  const tasks = [task({ status: 'completed', effort: 5 }), task({ status: 'in_progress', progress: 100, effort: 5 })];
  assert.equal(projectProgress(tasks), 95); // (5 + 4.5) / 10
  assert.equal(projectProgress([]), 0);
});

test('under review counts as 95% of its effort', () => {
  assert.equal(projectProgress([task({ status: 'under_review' })]), 95);
});

test('planned progress follows the calendar and is clamped', () => {
  assert.equal(plannedProgress(project, '2025-12-01'), 0);
  assert.equal(plannedProgress(project, '2026-01-16'), 50);
  assert.equal(plannedProgress(project, '2026-03-01'), 100);
});

test('health bands: steady, drifting, slipping, done, queued, empty', () => {
  const day = '2026-01-16'; // 50% planned
  const steady = [task({ status: 'completed', effort: 5 }), task({ effort: 5 })];
  assert.equal(projectHealth(project, steady, day).band, 'steady');
  const drift = [task({ status: 'in_progress', progress: 30, effort: 10, dueDate: '2026-01-10' })];
  assert.equal(projectHealth(project, drift, day).band, 'drifting'); // gap 23 -> -28, overdue -8 => 64
  const slip = [task({ effort: 10, dueDate: '2026-01-05' }), task({ effort: 10, dueDate: '2026-01-06' }), task({ blocked: true })];
  assert.equal(projectHealth(project, slip, day).band, 'slipping');
  assert.equal(projectHealth(project, [task({ status: 'completed' })], day).band, 'done');
  assert.equal(projectHealth(project, [task()], '2025-12-20').band, 'queued');
  assert.equal(projectHealth(project, [], day).band, 'empty');
  assert.equal(projectHealth({ ...project, status: 'on_hold' }, [task()], day).band, 'paused');
});

test('forecast needs data, then extrapolates velocity', () => {
  assert.equal(forecastFinish(project, 0, '2026-01-10'), null);
  assert.equal(forecastFinish(project, 20, '2026-01-02'), null); // < 3 days elapsed
  // 9 days elapsed, 30% done => 3.33%/day => 21 more days => Jan 31
  const f = forecastFinish(project, 30, '2026-01-10');
  assert.deepEqual(f, { date: '2026-01-31', slipDays: 0 });
  assert.equal(forecastFinish(project, 100, '2026-01-10'), null);
});

test('workload counts open effort due within a week, overdue included', () => {
  const tasks = [
    task({ effort: 5, dueDate: '2026-01-08' }), // overdue, counts
    task({ effort: 8, dueDate: '2026-01-12' }), // inside 7 days
    task({ effort: 13, dueDate: '2026-02-20' }), // too far
    task({ effort: 5, status: 'completed' }),
  ];
  const w = workload(tasks, 10, '2026-01-10');
  assert.equal(w.committedPoints, 13);
  assert.equal(w.openPoints, 26);
  assert.equal(w.band, 'overloaded');
});

const lead = { id: 'L', role: 'lead' };
const dev = { id: 'D', role: 'developer' };
const mk = (o) => ({ status: 'todo', assigneeId: 'D', blocked: false, progress: 0, ...o });

test('review gate: developers cannot complete, leads can only complete from review', () => {
  assert.throws(() => planTransition({ task: mk({ status: 'under_review' }), to: 'completed', actor: dev }), /approved by a team lead/);
  assert.throws(() => planTransition({ task: mk({ status: 'in_progress' }), to: 'completed', actor: lead }), /straight to/);
  const patch = planTransition({ task: mk({ status: 'under_review' }), to: 'completed', actor: lead });
  assert.equal(patch.progress, 100);
  assert.equal(patch.completedAt, true);
});

test('sending back or reopening needs a note; blockers stop submission; assignee required to start', () => {
  assert.throws(() => planTransition({ task: mk({ status: 'under_review' }), to: 'in_progress', actor: lead }), /note/);
  assert.equal(planTransition({ task: mk({ status: 'under_review', progress: 95 }), to: 'in_progress', actor: lead, note: 'Fix tests' }).progress, 90);
  assert.throws(() => planTransition({ task: mk({ status: 'in_progress', blocked: true }), to: 'under_review', actor: dev }), /blocker/);
  assert.throws(() => planTransition({ task: mk({ assigneeId: null }), to: 'in_progress', actor: lead }), /Assign/);
  assert.throws(() => planTransition({ task: mk({ assigneeId: 'X' }), to: 'in_progress', actor: dev }), /assignee/);
});
