import { conflict, forbidden } from './errors.js';

export const STATUSES = ['todo', 'in_progress', 'under_review', 'completed'];
export const PRIORITIES = ['high', 'medium', 'low'];

/**
 * The review gate. Allowed edges of the status graph:
 *
 *   todo -> in_progress -> under_review -> completed
 *             ^  |            |                |
 *             |  v            v                v
 *            todo         in_progress     in_progress (reopen)
 *
 * Only a lead may move a task into or out of `completed`.
 * Developers may only move tasks assigned to them.
 */
const EDGES = {
  todo: ['in_progress'],
  in_progress: ['todo', 'under_review'],
  under_review: ['in_progress', 'completed'],
  completed: ['in_progress'],
};

// Edges that must carry an explanation in the ledger.
const NOTE_REQUIRED = new Set(['under_review>in_progress', 'completed>in_progress']);

export function planTransition({ task, to, actor, note }) {
  const from = task.status;
  if (from === to) throw conflict(`Task is already ${label(to)}`);
  if (!EDGES[from].includes(to)) {
    throw conflict(`A task cannot go from ${label(from)} straight to ${label(to)}`, {
      allowed: EDGES[from],
    });
  }

  const isLead = actor.role === 'lead';
  if (!isLead && task.assigneeId !== actor.id) {
    throw forbidden('Only the assignee or a lead can move this task');
  }
  if (!isLead && (to === 'completed' || from === 'completed')) {
    throw forbidden('Completion is approved by a team lead. Submit the task for review instead.');
  }
  if (from === 'todo' && !task.assigneeId) {
    throw conflict('Assign the task to someone before starting it');
  }
  if (task.blocked && (to === 'under_review' || to === 'completed')) {
    throw conflict('Resolve the blocker before submitting or completing this task');
  }
  if (NOTE_REQUIRED.has(`${from}>${to}`) && !(note && note.trim())) {
    throw conflict('Add a short note explaining why (the assignee will see it)');
  }

  // Side effects on progress / completion stamp.
  const patch = { status: to };
  if (to === 'todo') patch.progress = 0;
  if (to === 'in_progress') patch.progress = Math.min(task.progress, 90);
  if (to === 'under_review') patch.progress = 95;
  if (to === 'completed') {
    patch.progress = 100;
    patch.completedAt = true;
  }
  if (from === 'completed') patch.completedAt = false;
  return patch;
}

const label = (s) => s.replace('_', ' ');

/** What the current user may do with a task, sent to the client so it can render the right buttons. */
export function taskActions(task, actor) {
  const isLead = actor.role === 'lead';
  const mine = task.assigneeId === actor.id;
  const can = (to) => {
    try {
      planTransition({ task, to, actor, note: 'x' });
      return true;
    } catch {
      return false;
    }
  };
  return {
    transitions: STATUSES.filter(can),
    canEdit: isLead,
    canPostUpdate: isLead || mine,
    canReportProgress: (isLead || mine) && task.status === 'in_progress',
    canBlock: (isLead || mine) && task.status !== 'completed',
    needsNote: STATUSES.filter(can).filter((to) => NOTE_REQUIRED.has(`${task.status}>${to}`)),
  };
}
