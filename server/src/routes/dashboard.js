import { Router } from 'express';
import { query } from '../db.js';
import { today } from '../config.js';
import { TASK_SELECT, taskDto, loadProjectsWithStats, visibleProjectsClause } from '../lib/data.js';
import { addDays, daysBetween, projectProgress, workload } from '../lib/metrics.js';

export const dashboardRouter = Router();

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

dashboardRouter.get('/', async (req, res) => {
  const asOf = today();
  const isLead = req.user.role === 'lead';

  const params = [];
  const visible = visibleProjectsClause(req.user, params);
  const [projects, { rows: taskRows }, { rows: people }] = await Promise.all([
    loadProjectsWithStats(req.user, asOf),
    query(`${TASK_SELECT} WHERE ${visible}`, params),
    isLead ? query('SELECT id, name, weekly_capacity FROM users WHERE active AND role = $1 ORDER BY name', ['developer']) : { rows: [] },
  ]);

  const allTasks = taskRows.map((r) => taskDto(r, asOf));
  // Developers see their own numbers; leads see the whole desk.
  const scope = isLead ? allTasks : allTasks.filter((t) => t.assigneeId === req.user.id);
  const assigned = scope.filter((t) => t.assigneeId);
  const open = assigned.filter((t) => t.status !== 'completed');
  const weekEnd = addDays(asOf, 7);

  const activeIds = new Set(projects.filter((p) => p.status === 'active').map((p) => p.id));
  const inActive = allTasks.filter((t) => activeIds.has(t.projectId));

  const totals = {
    activeProjects: activeIds.size,
    assignedTasks: assigned.length,
    completed: assigned.filter((t) => t.status === 'completed').length,
    pending: open.length,
    overdue: open.filter((t) => t.overdue).length,
    blocked: open.filter((t) => t.blocked).length,
    underReview: scope.filter((t) => t.status === 'under_review').length,
    dueThisWeek: open.filter((t) => t.dueDate && t.dueDate >= asOf && t.dueDate <= weekEnd).length,
    unassigned: isLead ? allTasks.filter((t) => !t.assigneeId && t.status !== 'completed').length : 0,
  };

  const load = isLead
    ? people.map((u) => ({
        id: u.id,
        name: u.name,
        ...workload(allTasks.filter((t) => t.assigneeId === u.id), u.weekly_capacity, asOf),
      }))
    : [];

  const rank = { high: 0, medium: 1, low: 2 };
  const attention = open
    .filter((t) => t.overdue || t.blocked)
    .sort((a, b) => (b.overdue - a.overdue) || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9') || rank[a.priority] - rank[b.priority])
    .slice(0, 8);
  const dueSoon = open
    .filter((t) => !t.overdue && t.dueDate && t.dueDate <= weekEnd)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || rank[a.priority] - rank[b.priority])
    .slice(0, 8);
  const reviewQueue = scope.filter((t) => t.status === 'under_review').slice(0, 8);

  // Leads see the whole ledger; developers see activity on tasks assigned to them.
  const ledgerParams = isLead ? [] : [req.user.id];
  const { rows: ledger } = await query(
    `SELECT tu.id, tu.kind, tu.body, tu.to_status, tu.progress, tu.created_at, u.name AS author_name,
            p.code || '-' || t.seq AS task_key, t.title AS task_title, t.id AS task_id
       FROM task_updates tu
       JOIN tasks t ON t.id = tu.task_id
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = tu.author_id
      WHERE ${isLead ? 'TRUE' : 't.assignee_id = $1'}
      ORDER BY tu.created_at DESC LIMIT 12`,
    ledgerParams,
  );

  res.json({
    asOf,
    scope: isLead ? 'team' : 'personal',
    totals,
    overallProgress: projectProgress(inActive),
    projects: projects.filter((p) => p.status !== 'completed' || isLead),
    workload: load,
    attention,
    dueSoon,
    reviewQueue,
    brief: buildBrief({ isLead, totals, attention, projects, load, asOf }),
    recent: ledger.map((r) => ({
      id: r.id, kind: r.kind, body: r.body, toStatus: r.to_status, progress: r.progress,
      createdAt: r.created_at, authorName: r.author_name, taskKey: r.task_key, taskTitle: r.task_title, taskId: r.task_id,
    })),
  });
});

/** One-line, plain-English observations. Order = importance. */
function buildBrief({ isLead, totals, attention, projects, load, asOf }) {
  const lines = [];
  const overdue = attention.filter((t) => t.overdue);
  if (overdue.length) {
    const worst = [...overdue].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    lines.push({
      tone: 'alert',
      text: `${plural(totals.overdue, 'task is', 'tasks are')} overdue. The oldest, ${worst.key}, is ${plural(daysBetween(worst.dueDate, asOf), 'day')} late.`,
      taskId: worst.id,
    });
  }
  const blocked = attention.filter((t) => t.blocked);
  if (blocked.length) {
    lines.push({
      tone: 'alert',
      text: `${plural(totals.blocked, 'task is', 'tasks are')} blocked. ${blocked[0].key}: ${blocked[0].blockedReason}`,
      taskId: blocked[0].id,
    });
  }
  if (totals.underReview) {
    lines.push({
      tone: 'note',
      text: isLead
        ? `${plural(totals.underReview, 'task')} waiting on your review.`
        : `${plural(totals.underReview, 'of your tasks is', 'of your tasks are')} waiting for lead review.`,
    });
  }
  for (const p of projects.filter((x) => x.stats.health.band === 'slipping' && x.status === 'active')) {
    const f = p.stats.forecast;
    lines.push({
      tone: 'alert',
      text: f && f.slipDays > 0
        ? `${p.name} is slipping. At the current pace it lands ${plural(f.slipDays, 'day')} after its due date.`
        : `${p.name} is slipping against its plan (${p.stats.progress}% done, ${p.stats.planned}% expected).`,
      projectId: p.id,
    });
  }
  for (const p of projects.filter((x) => x.stats.health.band === 'drifting' && x.status === 'active')) {
    lines.push({ tone: 'note', text: `${p.name} is drifting: ${p.stats.progress}% done against ${p.stats.planned}% expected by today.`, projectId: p.id });
  }
  for (const w of load.filter((x) => x.band === 'overloaded')) {
    lines.push({ tone: 'note', text: `${w.name} has ${w.committedPoints} points committed this week against a capacity of ${w.capacity}.` });
  }
  if (isLead && totals.unassigned) {
    lines.push({ tone: 'note', text: `${plural(totals.unassigned, 'open task has', 'open tasks have')} no owner yet.` });
  }
  if (!lines.length) lines.push({ tone: 'ok', text: 'Clean desk. Nothing overdue, nothing blocked, nothing waiting.' });
  return lines.slice(0, 5);
}
