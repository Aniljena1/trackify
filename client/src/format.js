export const STATUS = {
  todo: 'To Do',
  in_progress: 'In Progress',
  under_review: 'Under Review',
  completed: 'Completed',
};
export const STATUS_ORDER = ['todo', 'in_progress', 'under_review', 'completed'];
export const PRIORITY = { high: 'High', medium: 'Medium', low: 'Low' };
export const BAND = {
  steady: 'Steady', drifting: 'Drifting', slipping: 'Slipping',
  done: 'Done', queued: 'Queued', paused: 'Paused', empty: 'No tasks',
};
export const PROJECT_STATUS = { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed' };

export const localToday = () => new Date().toLocaleDateString('en-CA');

const parts = (s) => s.split('-').map(Number);
const utc = (s) => Date.UTC(...[parts(s)[0], parts(s)[1] - 1, parts(s)[2]]);
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86_400_000);

export function fmtDate(s, withYear = false) {
  if (!s) return 'No date';
  const d = new Date(utc(s));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

/** "3d late" | "due today" | "tomorrow" | "in 5d" */
export function dueLabel(due, status, today = localToday()) {
  if (!due) return 'No date';
  if (status === 'completed') return fmtDate(due);
  const d = daysBetween(today, due);
  if (d < 0) return `${-d}d late`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Tomorrow';
  if (d <= 14) return `In ${d}d`;
  return fmtDate(due);
}

export function timeAgo(iso) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso.slice(0, 10), true);
}

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
}
