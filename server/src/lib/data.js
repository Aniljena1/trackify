import { query } from '../db.js';
import { isOverdue, projectHealth, forecastFinish } from './metrics.js';

/** SQL fragment limiting rows to projects the user belongs to (leads see everything). */
export function visibleProjectsClause(user, params, alias = 'p') {
  if (user.role === 'lead') return 'TRUE';
  params.push(user.id);
  return `${alias}.id IN (SELECT project_id FROM project_members WHERE user_id = $${params.length})`;
}

export const TASK_SELECT = `
  SELECT t.id, t.project_id, t.seq, p.code || '-' || t.seq AS key,
         p.code AS project_code, p.name AS project_name,
         t.title, t.description, t.priority, t.status,
         t.assignee_id, u.name AS assignee_name,
         t.created_by, t.due_date, t.effort, t.progress,
         t.blocked, t.blocked_reason, t.created_at, t.updated_at, t.completed_at
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN users u ON u.id = t.assignee_id`;

export function taskDto(r, today) {
  const t = {
    id: r.id,
    key: r.key,
    projectId: r.project_id,
    projectCode: r.project_code,
    projectName: r.project_name,
    title: r.title,
    description: r.description,
    priority: r.priority,
    status: r.status,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_name,
    createdBy: r.created_by,
    dueDate: r.due_date,
    effort: r.effort,
    progress: r.progress,
    blocked: r.blocked,
    blockedReason: r.blocked_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
  t.overdue = isOverdue(t, today);
  return t;
}

export const userDto = (r) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  title: r.title,
  weeklyCapacity: r.weekly_capacity,
  active: r.active,
});

export const projectDto = (r) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  description: r.description,
  status: r.status,
  startDate: r.start_date,
  dueDate: r.due_date,
  ownerId: r.owner_id,
  ownerName: r.owner_name ?? null,
  createdAt: r.created_at,
});

/**
 * Loads projects visible to `user` together with per-project task stats:
 * counts by status, effort-weighted progress, health band and finish forecast.
 */
export async function loadProjectsWithStats(user, today, { projectId } = {}) {
  const params = [];
  const visible = visibleProjectsClause(user, params);
  let where = visible;
  if (projectId) {
    params.push(projectId);
    where += ` AND p.id = $${params.length}`;
  }
  const { rows: projectRows } = await query(
    `SELECT p.*, o.name AS owner_name FROM projects p LEFT JOIN users o ON o.id = p.owner_id
      WHERE ${where} ORDER BY p.due_date, p.name`,
    params,
  );
  if (projectRows.length === 0) return [];

  const ids = projectRows.map((p) => p.id);
  const { rows: taskRows } = await query(
    `SELECT project_id, status, progress, effort, due_date, blocked
       FROM tasks WHERE project_id = ANY($1::uuid[])`,
    [ids],
  );
  const byProject = new Map(ids.map((id) => [id, []]));
  for (const r of taskRows) {
    byProject.get(r.project_id).push({
      status: r.status,
      progress: r.progress,
      effort: r.effort,
      dueDate: r.due_date,
      blocked: r.blocked,
    });
  }

  const { rows: memberRows } = await query(
    `SELECT pm.project_id, u.id, u.name FROM project_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ANY($1::uuid[]) ORDER BY u.name`,
    [ids],
  );

  return projectRows.map((row) => {
    const project = projectDto(row);
    const tasks = byProject.get(row.id);
    const health = projectHealth(project, tasks, today);
    const counts = { todo: 0, in_progress: 0, under_review: 0, completed: 0 };
    tasks.forEach((t) => (counts[t.status] += 1));
    return {
      ...project,
      members: memberRows.filter((m) => m.project_id === row.id).map((m) => ({ id: m.id, name: m.name })),
      stats: {
        total: tasks.length,
        counts,
        overdue: health.overdue,
        blocked: health.blocked,
        progress: health.progress,
        planned: health.planned,
        health: { band: health.band, score: health.score },
        forecast: forecastFinish(project, health.progress, today),
        daysToDue: Math.round((Date.parse(project.dueDate) - Date.parse(today)) / 86_400_000),
      },
    };
  });
}

export async function addUpdate(client, { taskId, authorId, kind, body = '', fromStatus = null, toStatus = null, progress = null }) {
  await client.query(
    `INSERT INTO task_updates (task_id, author_id, kind, body, from_status, to_status, progress)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [taskId, authorId, kind, body, fromStatus, toStatus, progress],
  );
}

export async function ensureMember(client, projectId, userId) {
  await client.query(
    'INSERT INTO project_members (project_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [projectId, userId],
  );
}
