import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAction, useAuth } from '../store/hooks.jsx';
import { useBlockTaskMutation, useGetTaskQuery, usePostUpdateMutation, useReportProgressMutation, useTransitionTaskMutation } from '../store/apiSlice.js';
import { fmtDate, timeAgo, STATUS, dueLabel } from '../format.js';
import { Avatar, DueTag, ErrorNote, Loading, PriorityMark, Sheet, StatusPill } from '../ui.jsx';
import { TaskForm } from '../forms.jsx';

const VERB = {
  'todo>in_progress': 'Start work',
  'in_progress>todo': 'Move back to To Do',
  'in_progress>under_review': 'Submit for review',
  'under_review>completed': 'Approve and complete',
  'under_review>in_progress': 'Send back',
  'completed>in_progress': 'Reopen',
};

export default function TaskDrawer({ id, onClose }) {
  const { isLead } = useAuth();
  const act = useAction();
  // currentData (not data) so a previously opened task never flashes while the next one loads
  const { currentData: data, error } = useGetTaskQuery(id);
  const mutations = { transition: useTransitionTaskMutation()[0], progress: useReportProgressMutation()[0], updates: usePostUpdateMutation()[0], block: useBlockTaskMutation()[0] };
  const [pending, setPending] = useState(null); // { to, note }
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState(0);
  const [progressNote, setProgressNote] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);

  const task = data?.task;
  useEffect(() => { if (task) setProgress(Math.min(task.progress, 90)); }, [task?.id, task?.progress]); // eslint-disable-line
  useEffect(() => { setPending(null); setNote(''); setBlocking(false); }, [id, task?.status]);

  if (!task) {
    return <Sheet drawer title="Task" onClose={onClose}>{error ? <ErrorNote error={error} /> : <Loading />}</Sheet>;
  }
  const { actions, updates } = data;
  const post = (path, body, ok) => act(() => mutations[path]({ id, ...body }).unwrap(), ok);
  const transition = (to) => {
    const key = `${task.status}>${to}`;
    if (actions.needsNote.includes(to)) return setPending({ to, key });
    post('transition', { to }, `${task.key} is now ${STATUS[to]}`);
  };
  const confirmPending = async () => {
    const ok = await post('transition', { to: pending.to, note }, `${task.key} is now ${STATUS[pending.to]}`);
    if (ok) setPending(null);
  };

  return (
    <>
      <Sheet drawer onClose={onClose} title={task.title} kicker={`${task.key} · ${task.projectName}`}>
        <div className="row-actions" style={{ margin: '0 0 14px' }}>
          <StatusPill status={task.status} /><PriorityMark priority={task.priority} label /><DueTag task={task} />
          {isLead && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setEditing(true)}>Edit</button>}
        </div>

        {task.blocked && (
          <div className="banner" role="alert">
            <strong>Blocked</strong><span>{task.blockedReason}</span>
            {actions.canBlock && <div><button className="btn btn-ghost btn-sm" onClick={() => post('block', { blocked: false }, 'Blocker cleared')}>Clear blocker</button></div>}
          </div>
        )}

        {task.description && <p className="pre" style={{ marginBottom: 14 }}>{task.description}</p>}

        <dl className="meta-grid">
          <div><dt>Owner</dt><dd className="owner"><Avatar name={task.assigneeName} size={22} />{task.assigneeName ?? 'Unassigned'}</dd></div>
          <div><dt>Deadline</dt><dd>{task.dueDate ? `${fmtDate(task.dueDate, true)} · ${dueLabel(task.dueDate, task.status)}` : 'None set'}</dd></div>
          <div><dt>Effort</dt><dd>{task.effort} points</dd></div>
          <div><dt>Progress</dt><dd>{task.progress}%</dd></div>
        </dl>

        {pending ? (
          <div className="gate">
            <strong>{VERB[pending.key]}: say why</strong>
            <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="The assignee will see this in the ledger" />
            <div className="row-actions" style={{ margin: 0 }}>
              <button className="btn btn-red btn-sm" disabled={!note.trim()} onClick={confirmPending}>{VERB[pending.key]}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        ) : actions.transitions.length > 0 && (
          <div className="row-actions">
            {actions.transitions.map((to) => {
              const key = `${task.status}>${to}`;
              const primary = to === 'under_review' || to === 'completed' || (to === 'in_progress' && task.status === 'todo');
              return (
                <button key={to} className={`btn btn-sm ${to === 'completed' ? 'btn-sage' : primary ? '' : 'btn-ghost'}`} onClick={() => transition(to)}>
                  {VERB[key]}
                </button>
              );
            })}
          </div>
        )}
        {task.status === 'under_review' && !isLead && <p className="field-hint">Waiting for a team lead to approve or send this back.</p>}

        {actions.canReportProgress && (
          <>
            <div className="section-title">Report progress</div>
            <div className="slider-row">
              <input type="range" min="0" max="90" step="5" value={progress} onChange={(e) => setProgress(Number(e.target.value))} aria-label="Progress percent" />
              <b className="mono">{progress}%</b>
            </div>
            <input style={{ marginTop: 8 }} placeholder="What changed? (optional)" value={progressNote} onChange={(e) => setProgressNote(e.target.value)} />
            <div className="row-actions">
              <button className="btn btn-ghost btn-sm" disabled={progress === task.progress}
                onClick={async () => { if (await post('progress', { progress, note: progressNote || undefined }, 'Progress recorded')) setProgressNote(''); }}>
                Record {progress}%
              </button>
              <span className="field-hint">Up to 90%. Submitting for review takes it to 95%, approval to 100%.</span>
            </div>
          </>
        )}

        {actions.canBlock && !task.blocked && (
          blocking ? (
            <div className="gate" style={{ borderColor: 'var(--red)', background: 'var(--red-soft)' }}>
              <strong>What is blocking this?</strong>
              <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Waiting on API credentials" />
              <div className="row-actions" style={{ margin: 0 }}>
                <button className="btn btn-red btn-sm" disabled={!reason.trim()} onClick={async () => { if (await post('block', { blocked: true, reason }, 'Flagged as blocked')) { setBlocking(false); setReason(''); } }}>Flag blocker</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setBlocking(false)}>Cancel</button>
              </div>
            </div>
          ) : <button className="btn btn-ghost btn-sm" onClick={() => setBlocking(true)}>Flag a blocker</button>
        )}

        <div className="section-title">The ledger</div>
        {actions.canPostUpdate && <NoteBox onPost={(body) => post('updates', { body }, 'Update added')} />}
        <ul className="timeline">
          {updates.map((u) => (
            <li key={u.id} className={`k-${u.kind}`}>
              <div><span className="who">{u.authorName ?? 'Someone'}</span> <span className="mono dim">{describe(u)} · {timeAgo(u.createdAt)}</span></div>
              {u.body && <div className="body">{u.body}</div>}
            </li>
          ))}
        </ul>
        <p style={{ marginTop: 18 }}><Link className="mono" to={`/projects/${task.projectId}`} onClick={onClose}>Open {task.projectName} →</Link></p>
      </Sheet>
      {editing && <TaskForm task={task} onClose={() => setEditing(false)} />}
    </>
  );
}

function NoteBox({ onPost }) {
  const [text, setText] = useState('');
  return (
    <div style={{ marginBottom: 16 }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an update for the team…" style={{ minHeight: 64 }} />
      <div className="row-actions"><button className="btn btn-sm" disabled={!text.trim()} onClick={async () => { if (await onPost(text.trim())) setText(''); }}>Post update</button></div>
    </div>
  );
}

function describe(u) {
  switch (u.kind) {
    case 'status': return `${STATUS[u.fromStatus]} → ${STATUS[u.toStatus]}`;
    case 'progress': return `reported ${u.progress}%`;
    case 'block': return u.body === 'Blocker cleared' ? 'cleared blocker' : 'flagged blocker';
    case 'assign': return 'assignment';
    default: return 'note';
  }
}
