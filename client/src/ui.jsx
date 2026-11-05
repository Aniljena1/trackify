import { useEffect, useRef } from 'react';
import { BAND, STATUS, PRIORITY, initials, fmtDate, daysBetween, dueLabel } from './format.js';

export const Stamp = ({ band }) => <span className={`stamp stamp-${band}`}>{BAND[band]}</span>;

export const StatusPill = ({ status }) => <span className={`pill pill-${status}`}>{STATUS[status]}</span>;

export function PriorityMark({ priority, label = false }) {
  const n = { high: 3, medium: 2, low: 1 }[priority];
  return (
    <span className={`prio prio-${priority}`} title={`${PRIORITY[priority]} priority`}>
      {[1, 2, 3].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}
      {label && <b>{PRIORITY[priority]}</b>}
    </span>
  );
}

const HUES = ['#7a4e2d', '#2f4a7a', '#4f7a5a', '#8a3b5b', '#6b5a1e', '#3d6b72'];
export function Avatar({ name, size = 26 }) {
  if (!name) return <span className="avatar avatar-empty" style={{ width: size, height: size }} title="Unassigned">?</span>;
  const hue = HUES[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % HUES.length];
  return (
    <span className="avatar" style={{ width: size, height: size, background: hue, fontSize: size * 0.4 }} title={name}>
      {initials(name)}
    </span>
  );
}

/** Track with actual fill and a tick where progress *should* be today. */
export function PaceTrack({ progress, planned, band, height = 10 }) {
  const behind = planned != null && planned - progress > 10;
  return (
    <div className={`pace pace-${band}`} style={{ '--h': `${height}px` }}
      role="img" aria-label={`${progress}% complete${planned != null ? `, ${planned}% expected by today` : ''}`}>
      <div className="pace-fill" style={{ width: `${progress}%` }} />
      {planned != null && band !== 'done' && band !== 'queued' && (
        <div className={`pace-tick ${behind ? 'behind' : ''}`} style={{ left: `${planned}%` }} />
      )}
    </div>
  );
}

export function LoadStrip({ committed, capacity, band }) {
  const cells = Math.max(Math.ceil(capacity), 1);
  return (
    <div className={`load load-${band}`} role="img" aria-label={`${committed} of ${capacity} points committed this week`}>
      {Array.from({ length: Math.max(cells, committed) }, (_, i) => (
        <i key={i} className={`${i < committed ? 'on' : ''} ${i >= capacity ? 'over' : ''}`} />
      ))}
    </div>
  );
}

export function DueTag({ task }) {
  if (!task.dueDate) return <span className="mono dim">No date</span>;
  return <span className={`mono due ${task.overdue ? 'due-late' : ''}`}>{dueLabel(task.dueDate, task.status)}</span>;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">·  ·  ·</div>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export const Loading = ({ label = 'Loading' }) => <div className="loading mono">{label}…</div>;

export function ErrorNote({ error, retry }) {
  return (
    <div className="errnote" role="alert">
      <strong>Could not load this.</strong> {error?.message}
      {retry && <button className="btn btn-ghost" onClick={retry}>Try again</button>}
    </div>
  );
}

export function Field({ label, hint, error, children }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function useEscape(onClose) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

/** Centered dialog or right-hand drawer. */
export function Sheet({ title, kicker, onClose, children, drawer = false, wide = false }) {
  const ref = useRef(null);
  useEscape(onClose);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; prev?.focus?.(); };
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={`sheet ${drawer ? 'sheet-drawer' : ''} ${wide ? 'sheet-wide' : ''}`}>
        <header className="sheet-head">
          <div>
            {kicker && <div className="mono kicker">{kicker}</div>}
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}

/** A compact task card used on boards. */
export function TaskCard({ task, onOpen, showProject = true }) {
  return (
    <button className={`card task ${task.overdue ? 'is-late' : ''} ${task.blocked ? 'is-blocked' : ''}`} onClick={() => onOpen(task.id)}>
      <div className="task-top">
        <span className="mono key">{task.key}</span>
        <PriorityMark priority={task.priority} />
      </div>
      <div className="task-title">{task.title}</div>
      {task.blocked && <div className="task-block">Blocked: {task.blockedReason}</div>}
      {task.status === 'in_progress' && (
        <div className="task-progress"><span style={{ width: `${task.progress}%` }} /></div>
      )}
      <div className="task-foot">
        <Avatar name={task.assigneeName} size={22} />
        <span className="mono dim">{showProject ? task.projectCode : `${task.effort} pt`}</span>
        <DueTag task={task} />
      </div>
    </button>
  );
}

export function TaskBoard({ tasks, onOpen, showProject }) {
  const cols = ['todo', 'in_progress', 'under_review', 'completed'];
  return (
    <div className="board">
      {cols.map((s) => {
        const items = tasks.filter((t) => t.status === s);
        return (
          <section key={s} className={`col col-${s}`} aria-label={STATUS[s]}>
            <header><span>{STATUS[s]}</span><span className="mono">{items.length}</span></header>
            <div className="col-body">
              {items.map((t) => <TaskCard key={t.id} task={t} onOpen={onOpen} showProject={showProject} />)}
              {items.length === 0 && <div className="col-empty mono">Nothing here</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function TaskTable({ tasks, onOpen }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Key</th><th>Task</th><th>Status</th><th>Priority</th><th>Owner</th><th>Due</th><th className="num">Pts</th></tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} onClick={() => onOpen(t.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(t.id)}
              className={t.overdue ? 'row-late' : ''}>
              <td className="mono key">{t.key}</td>
              <td><span className="cell-title">{t.title}</span>{t.blocked && <span className="flag">blocked</span>}</td>
              <td><StatusPill status={t.status} /></td>
              <td><PriorityMark priority={t.priority} label /></td>
              <td><span className="owner"><Avatar name={t.assigneeName} size={20} />{t.assigneeName ?? <em className="dim">Unassigned</em>}</span></td>
              <td><DueTag task={t} /></td>
              <td className="num mono">{t.effort}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectPace({ project, onOpen }) {
  const s = project.stats;
  const f = s.forecast;
  let forecast = null;
  if (s.health.band === 'done') forecast = 'Delivered';
  else if (s.health.band === 'queued') forecast = `Starts ${fmtDate(project.startDate)}`;
  else if (s.health.band === 'paused') forecast = 'On hold';
  else if (f) forecast = f.slipDays > 0 ? `Lands ${fmtDate(f.date)}, ${f.slipDays}d late` : f.slipDays < 0 ? `Lands ${fmtDate(f.date)}, ${-f.slipDays}d early` : `Lands ${fmtDate(f.date)}, on the day`;
  else if (s.total) forecast = 'Too early to forecast';
  return (
    <button className="prow" onClick={() => onOpen(project.id)}>
      <div className="prow-head">
        <span className="mono key">{project.code}</span>
        <span className="prow-name">{project.name}</span>
        <Stamp band={s.health.band} />
      </div>
      <PaceTrack progress={s.progress} planned={s.planned} band={s.health.band} />
      <div className="prow-foot mono">
        <span><b>{s.progress}%</b> done{s.health.band !== 'done' && s.health.band !== 'queued' ? ` · ${s.planned}% expected` : ''}</span>
        <span>{forecast}</span>
        <span className={s.daysToDue < 0 && s.health.band !== 'done' ? 'due-late' : ''}>
          Due {fmtDate(project.dueDate)}
        </span>
      </div>
    </button>
  );
}

export { daysBetween };
