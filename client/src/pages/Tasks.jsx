import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUsers } from '../store/hooks.jsx';
import { useGetProjectsQuery, useGetTasksQuery } from '../store/apiSlice.js';
import { Empty, ErrorNote, Field, Loading, TaskBoard, TaskTable } from '../ui.jsx';
import { STATUS, PRIORITY } from '../format.js';
import { useOpenTask } from '../hooks.js';

export default function Tasks() {
  const [params, setParams] = useSearchParams();
  const openTask = useOpenTask();
  const users = useUsers();
  const projects = useGetProjectsQuery().data?.items ?? [];
  const [view, setView] = useState(() => localStorageGet('foreman.view') || 'list');
  const [q, setQ] = useState(params.get('q') ?? '');

  const f = {
    project: params.get('project') ?? '',
    status: params.get('status') ?? '',
    priority: params.get('priority') ?? '',
    assignee: params.get('assignee') ?? '',
    overdue: params.get('overdue') ?? '',
    q: params.get('q') ?? '',
  };
  const setF = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  // debounce search typing into the URL
  useEffect(() => {
    const t = setTimeout(() => q !== f.q && setF('q', q), 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line

  // Only send filters that are set: the API rejects empty strings for enums.
  const query = Object.fromEntries(Object.entries({ ...f, limit: 200 }).filter(([, v]) => v !== ''));
  const { data, error } = useGetTasksQuery(query);
  const chooseView = (v) => { setView(v); localStorageSet('foreman.view', v); };
  const active = Object.values({ ...f, q: '' }).some(Boolean) || f.q;

  return (
    <>
      <header className="page-head">
        <div><div className="kicker mono">Tasks</div><h1>Everything in flight</h1></div>
        <div className="seg" role="group" aria-label="View">
          <button className={view === 'list' ? 'on' : ''} onClick={() => chooseView('list')}>List</button>
          <button className={view === 'board' ? 'on' : ''} onClick={() => chooseView('board')}>Board</button>
        </div>
      </header>

      <div className="filters">
        <div className="search"><Field label="Search"><input type="search" placeholder="Title or key, e.g. PAY-3" value={q} onChange={(e) => setQ(e.target.value)} /></Field></div>
        <Field label="Project"><select value={f.project} onChange={(e) => setF('project', e.target.value)}><option value="">All</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
        <Field label="Status"><select value={f.status} onChange={(e) => setF('status', e.target.value)}><option value="">All</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Priority"><select value={f.priority} onChange={(e) => setF('priority', e.target.value)}><option value="">All</option>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Developer">
          <select value={f.assignee} onChange={(e) => setF('assignee', e.target.value)}>
            <option value="">Anyone</option><option value="me">Me</option><option value="unassigned">Unassigned</option>
            {users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <label className="chip-toggle" style={{ display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 8 }}>
          <input type="checkbox" checked={f.overdue === 'true'} onChange={(e) => setF('overdue', e.target.checked ? 'true' : '')} /> Overdue only
        </label>
        {active && <button className="btn btn-ghost btn-sm" style={{ marginBottom: 6 }} onClick={() => { setQ(''); setParams({}, { replace: true }); }}>Clear</button>}
      </div>

      {!data ? (error ? <ErrorNote error={error} /> : <Loading />) : data.items.length === 0 ? (
        <Empty title="No tasks match these filters">Try widening the search.</Empty>
      ) : (
        <>
          <p className="mono dim" style={{ marginBottom: 8 }}>{data.total} task{data.total === 1 ? '' : 's'}</p>
          {view === 'list' ? <TaskTable tasks={data.items} onOpen={openTask} /> : <TaskBoard tasks={data.items} onOpen={openTask} />}
        </>
      )}
    </>
  );
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
