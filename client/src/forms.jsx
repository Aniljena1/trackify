import { useState } from 'react';
import { Field, Sheet } from './ui.jsx';
import { useToast, useUsers } from './store/hooks.jsx';
import { useCreateProjectMutation, useCreateTaskMutation, useSetMembersMutation, useUpdateProjectMutation, useUpdateTaskMutation } from './store/apiSlice.js';
import { PROJECT_STATUS, localToday } from './format.js';
import { addDaysLocal } from './dates.js';

const EFFORTS = [1, 2, 3, 5, 8, 13];

function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const fail = (err) => {
    setErrors(err.details && typeof err.details === 'object' ? err.details : {});
    setFormError(err.message);
  };
  return { values, set, errors, formError, fail, setValues };
}

export function TaskForm({ project, task, onClose, onSaved }) {
  const users = useUsers().filter((u) => u.active !== false);
  const notify = useToast();
  const [createTask] = useCreateTaskMutation();
  const [updateTask] = useUpdateTaskMutation();
  const f = useForm({
    title: task?.title ?? '',
    description: task?.description ?? '',
    priority: task?.priority ?? 'medium',
    assigneeId: task?.assigneeId ?? '',
    dueDate: task?.dueDate ?? '',
    effort: String(task?.effort ?? 3),
  });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = {
      title: f.values.title,
      description: f.values.description,
      priority: f.values.priority,
      assigneeId: f.values.assigneeId || null,
      dueDate: f.values.dueDate || null,
      effort: Number(f.values.effort),
    };
    try {
      const r = task
        ? await updateTask({ id: task.id, ...body }).unwrap()
        : await createTask({ projectId: project.id, ...body }).unwrap();
      notify(task ? 'Task updated' : `Created ${r.task.key}`);
      onSaved?.(r.task);
      onClose();
    } catch (err) {
      f.fail(err);
      setBusy(false);
    }
  };

  return (
    <Sheet title={task ? `Edit ${task.key}` : 'New task'} kicker={project?.name ?? task?.projectName} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {f.formError && <div className="form-error" role="alert">{f.formError}</div>}
        <div className="form-grid">
          <div className="span2"><Field label="Title" error={f.errors.title}><input value={f.values.title} onChange={f.set('title')} autoFocus maxLength={140} /></Field></div>
          <div className="span2"><Field label="Description" error={f.errors.description}><textarea value={f.values.description} onChange={f.set('description')} /></Field></div>
          <Field label="Priority"><select value={f.values.priority} onChange={f.set('priority')}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></Field>
          <Field label="Effort (points)" hint="Weights this task in project progress" error={f.errors.effort}>
            <select value={f.values.effort} onChange={f.set('effort')}>{EFFORTS.map((n) => <option key={n}>{n}</option>)}</select>
          </Field>
          <Field label="Assignee" error={f.errors.assigneeId}>
            <select value={f.values.assigneeId} onChange={f.set('assigneeId')}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Deadline" error={f.errors.dueDate} hint={project ? `Must fall between ${project.startDate} and ${project.dueDate}` : undefined}>
            <input type="date" value={f.values.dueDate} onChange={f.set('dueDate')} min={project?.startDate} max={project?.dueDate} />
          </Field>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : task ? 'Save changes' : 'Create task'}</button>
        </div>
      </form>
    </Sheet>
  );
}

export function ProjectForm({ project, onClose, onSaved }) {
  const users = useUsers().filter((u) => u.active !== false && u.role !== 'lead');
  const notify = useToast();
  const [createProject] = useCreateProjectMutation();
  const [updateProject] = useUpdateProjectMutation();
  const t = localToday();
  const f = useForm({
    code: project?.code ?? '',
    name: project?.name ?? '',
    description: project?.description ?? '',
    status: project?.status ?? 'active',
    startDate: project?.startDate ?? t,
    dueDate: project?.dueDate ?? addDaysLocal(t, 28),
    memberIds: [],
  });
  const [busy, setBusy] = useState(false);
  const toggle = (id) => f.setValues((v) => ({ ...v, memberIds: v.memberIds.includes(id) ? v.memberIds.filter((x) => x !== id) : [...v.memberIds, id] }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = project
        ? await updateProject({ id: project.id, name: f.values.name, description: f.values.description, status: f.values.status, startDate: f.values.startDate, dueDate: f.values.dueDate }).unwrap()
        : await createProject(f.values).unwrap();
      notify(project ? 'Project updated' : `Created ${r.project.code}`);
      onSaved?.(r.project);
      onClose();
    } catch (err) {
      f.fail(err);
      setBusy(false);
    }
  };

  return (
    <Sheet title={project ? `Edit ${project.name}` : 'New project'} kicker={project ? project.code : 'Projects'} onClose={onClose} wide>
      <form onSubmit={submit} noValidate>
        {f.formError && <div className="form-error" role="alert">{f.formError}</div>}
        <div className="form-grid">
          {!project && (
            <Field label="Code" hint="2-5 letters. Task keys become CODE-1, CODE-2…" error={f.errors.code}>
              <input value={f.values.code} onChange={(e) => f.set('code')(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5))} />
            </Field>
          )}
          <div className={project ? 'span2' : ''}><Field label="Name" error={f.errors.name}><input value={f.values.name} onChange={f.set('name')} autoFocus={!!project} /></Field></div>
          <div className="span2"><Field label="Description" error={f.errors.description}><textarea value={f.values.description} onChange={f.set('description')} /></Field></div>
          <Field label="Start" error={f.errors.startDate}><input type="date" value={f.values.startDate} onChange={f.set('startDate')} /></Field>
          <Field label="Due" error={f.errors.dueDate}><input type="date" value={f.values.dueDate} onChange={f.set('dueDate')} min={f.values.startDate} /></Field>
          <Field label="Status" error={f.errors.status}>
            <select value={f.values.status} onChange={f.set('status')}>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          {!project && (
            <div className="span2">
              <Field label="Team" error={f.errors.memberIds}>
                <div className="check-list">
                  {users.map((u) => (
                    <label key={u.id}><input type="checkbox" checked={f.values.memberIds.includes(u.id)} onChange={() => toggle(u.id)} />{u.name}</label>
                  ))}
                </div>
              </Field>
            </div>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : project ? 'Save changes' : 'Create project'}</button>
        </div>
      </form>
    </Sheet>
  );
}

export function MembersForm({ project, onClose }) {
  const users = useUsers().filter((u) => u.active !== false && u.role !== 'lead');
  const notify = useToast();
  const [setMembers] = useSetMembersMutation();
  const [ids, setIds] = useState(project.members.map((m) => m.id));
  const [error, setError] = useState('');
  const toggle = (id) => setIds((x) => (x.includes(id) ? x.filter((i) => i !== id) : [...x, id]));
  const submit = async () => {
    setError('');
    try {
      await setMembers({ id: project.id, memberIds: ids }).unwrap();
      notify('Team updated');
      onClose();
    } catch (e) { setError(e.message); }
  };
  return (
    <Sheet title="Project team" kicker={project.code} onClose={onClose}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="check-list">
        {users.map((u) => <label key={u.id}><input type="checkbox" checked={ids.includes(u.id)} onChange={() => toggle(u.id)} />{u.name}</label>)}
      </div>
      <p className="field-hint" style={{ marginTop: 12 }}>Assigning a task to someone adds them automatically. Members with open tasks cannot be removed until those are reassigned.</p>
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit}>Save team</button>
      </div>
    </Sheet>
  );
}
