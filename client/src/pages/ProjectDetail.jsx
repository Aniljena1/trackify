import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAction, useAuth } from '../store/hooks.jsx';
import { useDeleteProjectMutation, useGetProjectQuery, useGetTasksQuery } from '../store/apiSlice.js';
import { fmtDate, PROJECT_STATUS } from '../format.js';
import { Avatar, ErrorNote, Loading, PaceTrack, Stamp, TaskBoard } from '../ui.jsx';
import { MembersForm, ProjectForm, TaskForm } from '../forms.jsx';
import { useOpenTask } from '../hooks.js';

export default function ProjectDetail() {
  const { id } = useParams();
  const { isLead } = useAuth();
  const nav = useNavigate();
  const act = useAction();
  const openTask = useOpenTask();
  const [mode, setMode] = useState(null); // 'task' | 'edit' | 'members'
  const [mine, setMine] = useState(false);
  const proj = useGetProjectQuery(id);
  const tasks = useGetTasksQuery({ project: id, limit: 200, sort: 'due' });
  const [deleteProject] = useDeleteProjectMutation();

  if (proj.error?.status === 404) return <ErrorNote error={{ message: 'That project does not exist or you are not a member.' }} />;
  if (!proj.data || !tasks.data) return proj.error ? <ErrorNote error={proj.error} /> : <Loading />;
  const p = proj.data.project;
  const s = p.stats;
  const f = s.forecast;

  const remove = async () => {
    if (!window.confirm(`Delete ${p.name}? This cannot be undone.`)) return;
    if (await act(() => deleteProject(p.id).unwrap(), 'Project deleted')) nav('/projects');
  };

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker mono"><Link to="/projects">Projects</Link> / {p.code} · {PROJECT_STATUS[p.status]}</div>
          <h1>{p.name}</h1>
          {p.description && <p className="sub">{p.description}</p>}
        </div>
        {isLead && (
          <div className="actions">
            <button className="btn btn-ghost" onClick={() => setMode('edit')}>Edit</button>
            <button className="btn btn-ghost" onClick={() => setMode('members')}>Team</button>
            <button className="btn" onClick={() => setMode('task')}>New task</button>
          </div>
        )}
      </header>

      <section className="panel">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Stamp band={s.health.band} />
          {s.health.score != null && <span className="mono">health {s.health.score}/100</span>}
          <span className="mono dim" style={{ marginLeft: 'auto' }}>{fmtDate(p.startDate, true)} → {fmtDate(p.dueDate, true)}</span>
        </div>
        <PaceTrack progress={s.progress} planned={s.planned} band={s.health.band} height={14} />
        <div className="stat-line">
          <div><div className="n">{s.progress}%</div><div className="l">Done</div></div>
          <div><div className="n">{s.planned}%</div><div className="l">Expected</div></div>
          <div><div className="n" style={s.overdue ? { color: 'var(--red)' } : null}>{s.overdue}</div><div className="l">Overdue</div></div>
          <div><div className="n">{s.blocked}</div><div className="l">Blocked</div></div>
          <div><div className="n">{s.counts.under_review}</div><div className="l">In review</div></div>
          <div><div className="n">{s.total}</div><div className="l">Tasks</div></div>
          <div><div className="n" style={{ fontSize: 20, paddingTop: 6 }}>
            {f ? fmtDate(f.date) : '—'}</div><div className="l">{f ? (f.slipDays > 0 ? `Forecast · ${f.slipDays}d late` : f.slipDays < 0 ? `Forecast · ${-f.slipDays}d early` : 'Forecast · on time') : 'Forecast'}</div></div>
        </div>
        <div className="member-list" style={{ marginTop: 12 }}>
          {p.members.map((m) => <span className="member" key={m.id}><Avatar name={m.name} size={22} />{m.name}</span>)}
        </div>
      </section>

      <div className="page-head" style={{ marginTop: 26, marginBottom: 12 }}>
        <h2>Task board</h2>
        <div className="actions">
          <button className={`chip ${mine ? 'on' : ''}`} onClick={() => setMine((v) => !v)}>Mine only</button>
          {isLead && tasks.data.total === 0 && <button className="btn btn-ghost btn-sm" onClick={remove}>Delete project</button>}
        </div>
      </div>
      <MineBoard tasks={tasks.data.items} mine={mine} onOpen={openTask} />

      {mode === 'task' && <TaskForm project={p} onClose={() => setMode(null)} />}
      {mode === 'edit' && <ProjectForm project={p} onClose={() => setMode(null)} />}
      {mode === 'members' && <MembersForm project={p} onClose={() => setMode(null)} />}
    </>
  );
}

function MineBoard({ tasks, mine, onOpen }) {
  const { user } = useAuth();
  const shown = mine ? tasks.filter((t) => t.assigneeId === user.id) : tasks;
  return <TaskBoard tasks={shown} onOpen={onOpen} showProject={false} />;
}
