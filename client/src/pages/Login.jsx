import { useState } from 'react';
import { useAuth } from '../store/hooks.jsx';
import { Field } from '../ui.jsx';

const DEMO = [
  ['Team lead', 'lead@foreman.dev'],
  ['Developer (Asha)', 'asha@foreman.dev'],
  ['Developer (Ravi)', 'ravi@foreman.dev'],
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e, creds) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(creds?.email ?? email, creds?.password ?? password);
    } catch (err) {
      setError(err.details?.email || err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-art">
        <div className="brand"><span className="brand-mark">T</span><span className="brand-name">Trackify</span></div>
        <h1>The desk where deadlines get <em>honest</em>.</h1>
        <ul className="principles">
          <li><span className="mono">01</span><div><strong>Pace, not percentages</strong>Every project shows where it is against where it should be today.</div></li>
          <li><span className="mono">02</span><div><strong>A review gate</strong>Developers submit. Leads approve. Nothing is "done" on its own say-so.</div></li>
          <li><span className="mono">03</span><div><strong>A ledger, not a chat</strong>Every status change, blocker and note is written down once.</div></li>
        </ul>
      </section>
      <section className="login-form">
        <form onSubmit={submit} noValidate>
          <div>
            <div className="kicker mono">Sign in</div>
            <h2 style={{ fontSize: 28 }}>Welcome back</h2>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <button className="btn" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="demo">
            <span className="mono dim">DEMO ACCOUNTS · password Foreman@123</span>
            <div className="chips">
              {DEMO.map(([label, mail]) => (
                <button type="button" key={mail} className="chip" disabled={busy}
                  onClick={() => { setEmail(mail); setPassword('Foreman@123'); submit(null, { email: mail, password: 'Foreman@123' }); }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
