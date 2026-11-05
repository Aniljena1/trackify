/**
 * Pure functions that turn raw task rows into the numbers Trackify shows.
 * Everything takes `today` as a YYYY-MM-DD string so it is trivially testable.
 */

const DAY = 86_400_000;
const toUtc = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const daysBetween = (from, to) => Math.round((toUtc(to) - toUtc(from)) / DAY);
export const addDays = (s, n) => new Date(toUtc(s) + n * DAY).toISOString().slice(0, 10);

/** Share of a task's effort that counts as "done". */
export function taskCredit(task) {
  switch (task.status) {
    case 'completed':
      return 1;
    case 'under_review':
      return 0.95; // built, waiting on the lead's sign-off
    case 'in_progress':
      return Math.min(task.progress, 90) / 100;
    default:
      return 0;
  }
}

export const isOverdue = (task, today) =>
  Boolean(task.dueDate) && task.status !== 'completed' && task.dueDate < today;

/** Effort-weighted completion, 0-100. */
export function projectProgress(tasks) {
  const total = tasks.reduce((s, t) => s + t.effort, 0);
  if (total === 0) return 0;
  const done = tasks.reduce((s, t) => s + t.effort * taskCredit(t), 0);
  return Math.round((done / total) * 100);
}

/** Where progress *should* be today if work were spread evenly, 0-100. */
export function plannedProgress(project, today) {
  const span = Math.max(daysBetween(project.startDate, project.dueDate), 1);
  const elapsed = daysBetween(project.startDate, today);
  return Math.round(Math.min(Math.max(elapsed / span, 0), 1) * 100);
}

/**
 * Health score + band.
 *   score = 100 - 1.2 x pace gap - 8 per overdue task (max 40) - 5 per blocked task (max 15)
 *   >= 75 steady, 50-74 drifting, < 50 slipping
 */
export function projectHealth(project, tasks, today) {
  const progress = projectProgress(tasks);
  const planned = plannedProgress(project, today);
  const overdue = tasks.filter((t) => isOverdue(t, today)).length;
  const blocked = tasks.filter((t) => t.blocked && t.status !== 'completed').length;

  let band;
  let score = null;
  if (project.status === 'completed' || (tasks.length > 0 && tasks.every((t) => t.status === 'completed'))) {
    band = 'done';
  } else if (project.status === 'on_hold') {
    band = 'paused';
  } else if (today < project.startDate) {
    band = 'queued';
  } else if (tasks.length === 0) {
    band = 'empty';
  } else {
    const paceGap = Math.max(0, planned - progress);
    score = 100 - 1.2 * paceGap - Math.min(overdue * 8, 40) - Math.min(blocked * 5, 15);
    score = Math.max(0, Math.min(100, Math.round(score)));
    band = score >= 75 ? 'steady' : score >= 50 ? 'drifting' : 'slipping';
  }
  return { band, score, progress, planned, overdue, blocked };
}

/**
 * Straight-line finish forecast from average velocity since the project began.
 * Returns null until there are >= 3 elapsed days and some progress to extrapolate.
 */
export function forecastFinish(project, progress, today) {
  if (progress >= 100) return null;
  const elapsed = daysBetween(project.startDate, today);
  if (elapsed < 3 || progress <= 0) return null;
  const velocity = progress / elapsed; // % per day
  const remaining = Math.ceil((100 - progress) / velocity);
  const date = addDays(today, remaining);
  return { date, slipDays: daysBetween(project.dueDate, date) };
}

/**
 * Committed load for a person: open effort due within `horizon` days (overdue included)
 * measured against their weekly capacity.
 */
export function workload(tasks, capacity, today, horizon = 7) {
  const open = tasks.filter((t) => t.status !== 'completed');
  const limit = addDays(today, horizon);
  const committed = open
    .filter((t) => t.dueDate && t.dueDate <= limit)
    .reduce((s, t) => s + t.effort, 0);
  const openPoints = open.reduce((s, t) => s + t.effort, 0);
  const pct = Math.round((committed / capacity) * 100);
  return {
    openTasks: open.length,
    openPoints,
    committedPoints: committed,
    capacity,
    loadPct: pct,
    band: pct > 100 ? 'overloaded' : pct >= 60 ? 'balanced' : 'light',
  };
}
