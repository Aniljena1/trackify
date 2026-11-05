import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/hooks.jsx';
import { useGetProjectsQuery } from '../store/apiSlice.js';
import { Empty, ErrorNote, Loading, ProjectPace } from '../ui.jsx';
import { ProjectForm } from '../forms.jsx';
import { PROJECT_STATUS } from '../format.js';

export default function Projects() {
  const { isLead } = useAuth();
  const nav = useNavigate();
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const { data, error } = useGetProjectsQuery();
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;
  const items = data.items.filter((p) => filter === 'all' || p.status === filter);

  return (
    <>
      <header className="page-head">
        <div>
          <div className="kicker mono">Projects</div>
          <h1>{isLead ? 'Every project, against its plan' : 'Your projects'}</h1>
          <p className="sub">The tick marks where progress should be today. The fill is where it actually is.</p>
        </div>
        {isLead && <div className="actions"><button className="btn" onClick={() => setCreating(true)}>New project</button></div>}
      </header>
      <div className="chips" style={{ marginBottom: 12 }} role="group" aria-label="Filter by status">
        {['all', ...Object.keys(PROJECT_STATUS)].map((s) => (
          <button key={s} className={`chip ${filter === s ? 'on' : ''}`} onClick={() => setFilter(s)}>{s === 'all' ? 'All' : PROJECT_STATUS[s]}</button>
        ))}
      </div>
      <section className="panel">
        {items.length === 0 ? <Empty title="No projects match">{isLead ? 'Create one to get started.' : 'You have not been added to any yet.'}</Empty>
          : items.map((p) => (
            <div key={p.id}>
              <ProjectPace project={p} onOpen={(id) => nav(`/projects/${id}`)} />
              <div className="mono dim" style={{ marginTop: -6, paddingBottom: 10 }}>
                {p.stats.total} tasks · {p.stats.counts.completed} done · {p.stats.overdue} overdue · {p.members.length} people
              </div>
            </div>
          ))}
      </section>
      {creating && <ProjectForm onClose={() => setCreating(false)} onSaved={(p) => nav(`/projects/${p.id}`)} />}
    </>
  );
}
