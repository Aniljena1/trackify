import { useState } from 'react';
import { useAction } from '../store/hooks.jsx';
import { useCreateUserMutation, useGetUsersQuery, useUpdateUserMutation } from '../store/apiSlice.js';
import { Avatar, ErrorNote, Field, Loading, LoadStrip, Sheet } from '../ui.jsx';

export default function Team() {
  const [adding, setAdding] = useState(false);
  const act = useAction();
  const { data, error } = useGetUsersQuery();
  const [updateUser] = useUpdateUserMutation();
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;

  const toggle = (u) => act(() => updateUser({ id: u.id, active: !u.active }).unwrap(), u.active ? `${u.name} deactivated` : `${u.name} reactivated`);

  return (
    <>
      <header className="page-head">
        <div><div className="kicker mono">Team</div><h1>Who is carrying what</h1>
          <p className="sub">Load counts open points due within 7 days (overdue included) against each person's weekly capacity.</p></div>
        <div className="actions"><button className="btn" onClick={() => setAdding(true)}>Add person</button></div>
      </header>
      <section className="panel">
        {data.items.map((u) => (
          <div className="person-row" key={u.id} style={u.active ? null : { opacity: 0.55 }}>
            <Avatar name={u.name} size={30} />
            <div><div className="name">{u.name} {u.role === 'lead' && <span className="stamp stamp-done" style={{ marginLeft: 6 }}>Lead</span>}{!u.active && <span className="stamp stamp-paused" style={{ marginLeft: 6 }}>Inactive</span>}</div>
              <div className="mono dim">{u.title || '—'} · {u.email}</div></div>
            <button className="btn btn-ghost btn-sm" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</button>
            {u.active && u.workload && (
              <>
                <LoadStrip committed={u.workload.committedPoints} capacity={u.workload.capacity} band={u.workload.band} />
                <span className="meta mono">
                  {u.workload.committedPoints}/{u.workload.capacity} pts this week · {u.workload.openTasks} open ({u.workload.openPoints} pts) · {u.workload.band}
                </span>
              </>
            )}
          </div>
        ))}
      </section>
      {adding && <AddPerson onClose={() => setAdding(false)} />}
    </>
  );
}

function AddPerson({ onClose }) {
  const act = useAction();
  const [createUser] = useCreateUserMutation();
  const [v, setV] = useState({ name: '', email: '', password: '', title: '', role: 'developer', weeklyCapacity: '20' });
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setMsg(''); setErrors({});
    try {
      await act(() => createUser({ ...v, weeklyCapacity: Number(v.weeklyCapacity) }).unwrap(), `${v.name} added`);
      onClose();
    } catch (err) { setErrors(err.details ?? {}); setMsg(err.message); }
  };
  return (
    <Sheet title="Add a person" kicker="Team" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {msg && <div className="form-error" role="alert">{msg}</div>}
        <div className="form-grid">
          <Field label="Name" error={errors.name}><input value={v.name} onChange={set('name')} autoFocus /></Field>
          <Field label="Title" error={errors.title}><input value={v.title} onChange={set('title')} placeholder="e.g. Backend Engineer" /></Field>
          <div className="span2"><Field label="Email" error={errors.email}><input type="email" value={v.email} onChange={set('email')} /></Field></div>
          <Field label="Temporary password" hint="8+ characters with a letter and a number" error={errors.password}><input type="text" value={v.password} onChange={set('password')} autoComplete="off" /></Field>
          <Field label="Weekly capacity (pts)" error={errors.weeklyCapacity}><input type="number" min="1" max="100" value={v.weeklyCapacity} onChange={set('weeklyCapacity')} /></Field>
          <Field label="Role"><select value={v.role} onChange={set('role')}><option value="developer">Developer</option><option value="lead">Team lead</option></select></Field>
        </div>
        <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn">Add person</button></div>
      </form>
    </Sheet>
  );
}
