import { Navigate, NavLink, Outlet, Route, Routes, Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from './store/hooks.jsx';
import { Avatar, Loading } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import Tasks from './pages/Tasks.jsx';
import MyWork from './pages/MyWork.jsx';
import Team from './pages/Team.jsx';
import TaskDrawer from './pages/TaskDrawer.jsx';

export default function App() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading label="Opening the desk" />;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="my-work" element={<MyWork />} />
        <Route path="team" element={<TeamGuard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

const TeamGuard = () => (useAuth().isLead ? <Team /> : <Navigate to="/" replace />);


function Shell() {
  const { user, logout, isLead } = useAuth();
  const [params, setParams] = useSearchParams();
  const taskId = params.get('task');
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('task');
    setParams(next, { replace: true });
  };
  const links = [
    ['/', '01', 'Desk', true],
    ...(isLead ? [] : [['/my-work', '02', 'My work']]),
    ['/projects', '03', 'Projects'],
    ['/tasks', '04', 'Tasks'],
    ...(isLead ? [['/team', '05', 'Team']] : []),
  ];
  return (
    <div className="shell">
      <aside className="rail">
        <Link to="/" className="brand" aria-label="Trackify home">
          <span className="brand-mark">T</span>
          <span className="brand-name">Trackify</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {links.map(([to, n, label, end]) => (
            <NavLink key={to} to={to} end={end}>
              <span className="mono">{n}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="rail-foot">
          <div className="who">
            <Avatar name={user.name} size={30} />
            <div><strong>{user.name}</strong><span className="role">{isLead ? 'Team lead' : user.title || 'Developer'}</span></div>
          </div>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
      {taskId && <TaskDrawer id={taskId} onClose={close} />}
    </div>
  );
}
