import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/hooks.jsx';
import { useGetDashboardQuery } from '../store/apiSlice.js';
import { fmtDate, greeting, timeAgo, STATUS } from '../format.js';
import { Avatar, DueTag, Empty, ErrorNote, Loading, LoadStrip, PaceTrack, ProjectPace } from '../ui.jsx';
import { useOpenTask } from '../hooks.js';

export default function Dashboard() {
  const { user, isLead } = useAuth();
  const nav = useNavigate();
  const openTask = useOpenTask();
  const { data: d, error } = useGetDashboardQuery();

  if (!d) return error ? <ErrorNote error={error} /> : <Loading label="Reading the desk" />;
  const t = d.totals;
  const projects = d.projects.filter((p) => p.status !== 'completed');
  const stats = [
    ['Active projects', t.activeProjects],
    [isLead ? 'Assigned tasks' : 'My tasks', t.assignedTasks],
    ['Completed', t.completed],
    ['Pending', t.pending],
    ['Overdue', t.overdue, t.overdue > 0],
    ['Under review', t.underReview],
  ];

  const clickBrief = (b) => (b.taskId ? openTask(b.taskId) : b.projectId ? nav(`/projects/${b.projectId}`) : null);

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker mono">{new Date(d.asOf + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · {isLead ? 'Whole team' : 'Your tasks'}</div>
          <h1>{greeting()} brief, {user.name.split(' ')[0]}.</h1>
        </div>
      </header>

      <ul className="brief" aria-label="What needs your attention">
        {d.brief.map((b, i) => (
          <li key={i} className={`t-${b.tone}`}>
            {b.taskId || b.projectId ? <button onClick={() => clickBrief(b)}>{b.text}</button> : <span>{b.text}</span>}
          </li>
        ))}
      </ul>

      <section className="ledger" aria-label="Key numbers">
        {stats.map(([label, n, bad]) => (
          <div key={label}><div className={`n ${bad ? 'bad' : ''}`}>{n}</div><div className="l">{label}</div></div>
        ))}
      </section>
      <div className="overall">
        <span className="mono">OVERALL PROGRESS</span>
        <PaceTrack progress={d.overallProgress} band="steady" height={12} />
        <b className="mono">{d.overallProgress}%</b>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2>Projects on the desk <span className="mono">tick = expected by today</span></h2>
          {projects.length === 0 ? <Empty title="No projects yet" /> : projects.map((p) => <ProjectPace key={p.id} project={p} onOpen={(id) => nav(`/projects/${id}`)} />)}
        </section>

        <div className="stack">
          {isLead ? (
            <section className="panel">
              <h2>Load this week <span className="mono">points / capacity</span></h2>
              {d.workload.map((w) => (
                <div className="person-row" key={w.id}>
                  <Avatar name={w.name} />
                  <span className="name">{w.name}</span>
                  <span className={`mono ${w.band === 'overloaded' ? 'due-late' : ''}`}>{w.committedPoints}/{w.capacity}</span>
                  <LoadStrip committed={w.committedPoints} capacity={w.capacity} band={w.band} />
                  <span className="meta mono">{w.openTasks} open · {w.openPoints} pts total · {w.band}</span>
                </div>
              ))}
            </section>
          ) : null}

          <section className="panel">
            <h2>{isLead ? 'Waiting on your review' : 'In review'} <span className="mono">{d.reviewQueue.length}</span></h2>
            {d.reviewQueue.length === 0 ? <Empty title="Queue is empty" /> : (
              <ul className="lines">
                {d.reviewQueue.map((x) => (
                  <li key={x.id}><button onClick={() => openTask(x.id)}>
                    <span className="mono key">{x.key}</span><span className="l-title">{x.title}</span><span className="mono dim">{x.assigneeName?.split(' ')[0]}</span>
                  </button></li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="grid-2e">
        <section className="panel">
          <h2>Needs attention <span className="mono">{t.overdue + t.blocked > 0 ? 'overdue and blocked' : ''}</span></h2>
          {d.attention.length === 0 ? <Empty title="Nothing overdue or blocked" /> : (
            <ul className="lines">
              {d.attention.map((x) => (
                <li key={x.id}><button onClick={() => openTask(x.id)}>
                  <span className="mono key">{x.key}</span><span className="l-title">{x.title}</span><DueTag task={x} />
                  {x.blocked && <span className="l-sub">Blocked: {x.blockedReason}</span>}
                </button></li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2>Due in the next 7 days <span className="mono">{t.dueThisWeek}</span></h2>
          {d.dueSoon.length === 0 ? <Empty title="Quiet week ahead" /> : (
            <ul className="lines">
              {d.dueSoon.map((x) => (
                <li key={x.id}><button onClick={() => openTask(x.id)}>
                  <span className="mono key">{x.key}</span><span className="l-title">{x.title}</span><span className="mono dim">{fmtDate(x.dueDate)}</span>
                </button></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <h2>The ledger <span className="mono">latest entries</span></h2>
        {d.recent.length === 0 ? <Empty title="No activity yet" /> : (
          <ul className="ledger-feed">
            {d.recent.map((r) => (
              <li key={r.id}>
                <span className="mono when">{timeAgo(r.createdAt)}</span>
                <span>
                  <b>{r.authorName ?? 'Someone'}</b> {describe(r)} <button onClick={() => openTask(r.taskId)}>{r.taskKey}</button>
                  {r.body && !(r.kind === 'assign' && r.body.startsWith('Task created')) ? <span className="dim"> · {r.body}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function describe(r) {
  switch (r.kind) {
    case 'status': return `moved to ${STATUS[r.toStatus]}`;
    case 'progress': return `reported ${r.progress}% on`;
    case 'block': return r.body === 'Blocker cleared' ? 'cleared a blocker on' : 'flagged a blocker on';
    case 'assign': return r.body.startsWith('Task created') ? 'created' : 'changed the owner of';
    default: return 'noted on';
  }
}
