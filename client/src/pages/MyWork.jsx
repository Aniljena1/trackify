import { useAuth } from '../store/hooks.jsx';
import { useGetTasksQuery } from '../store/apiSlice.js';
import { Empty, ErrorNote, Loading, TaskCard } from '../ui.jsx';
import { useOpenTask } from '../hooks.js';
import { daysBetween, localToday } from '../format.js';

const GROUPS = [
  ['Blocked', (t) => t.blocked],
  ['Overdue', (t) => t.overdue],
  ['Due this week', (t, today) => t.dueDate && daysBetween(today, t.dueDate) <= 7],
  ['Later', () => true],
];

export default function MyWork() {
  const { user } = useAuth();
  const openTask = useOpenTask();
  const { data, error } = useGetTasksQuery({ assignee: 'me', limit: 200, sort: 'due' });
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;

  const today = localToday();
  const open = data.items.filter((t) => t.status !== 'completed');
  const done = data.items.filter((t) => t.status === 'completed');
  const seen = new Set();
  const groups = GROUPS.map(([label, test]) => {
    const items = open.filter((t) => !seen.has(t.id) && test(t, today));
    items.forEach((t) => seen.add(t.id));
    return [label, items];
  });

  return (
    <>
      <header className="page-head">
        <div><div className="kicker mono">My work</div><h1>{open.length ? `${open.length} open for you, ${user.name.split(' ')[0]}` : 'You are all caught up'}</h1>
          <p className="sub">Grouped by what will hurt first if it slips.</p></div>
      </header>
      {open.length === 0 && <Empty title="Nothing assigned right now">New work will appear here when a lead assigns it.</Empty>}
      {groups.filter(([, items]) => items.length).map(([label, items]) => (
        <section key={label} style={{ marginBottom: 22 }}>
          <h2 style={{ marginBottom: 10 }}>{label} <span className="mono dim">{items.length}</span></h2>
          <div className="board" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
            {items.map((t) => <TaskCard key={t.id} task={t} onOpen={openTask} />)}
          </div>
        </section>
      ))}
      {done.length > 0 && <p className="mono dim">{done.length} completed task{done.length === 1 ? '' : 's'} not shown.</p>}
    </>
  );
}
