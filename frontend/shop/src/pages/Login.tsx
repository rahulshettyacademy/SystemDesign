import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api';
import { useApp } from '../state';

export function Login() {
  const { login } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      const next = params.get('next');
      navigate(next && next.startsWith('/') ? next : '/');
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const fieldError = (f: string) => (Array.isArray(error?.details) ? error!.details.find((d: any) => d.field === f)?.message : undefined);

  return (
    <div className="auth-page">
      <Link to="/" className="logo logo--dark"><span className="logo__mark">QA</span>Mart</Link>
      <form className="card auth-card" onSubmit={submit} noValidate data-testid="login-form">
        <h1>Sign in</h1>
        {error && !error.details && <div className="alert alert--error" role="alert" data-testid="login-error">{error.message}</div>}
        <label className={`field ${fieldError('email') ? 'has-error' : ''}`}>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" data-testid="login-email" />
          {fieldError('email') && <small className="field__error">Email {fieldError('email')}</small>}
        </label>
        <label className={`field ${fieldError('password') ? 'has-error' : ''}`}>
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" data-testid="login-password" />
          {fieldError('password') && <small className="field__error">Password {fieldError('password')}</small>}
        </label>
        <button className="btn btn--primary btn--block" disabled={busy} data-testid="login-submit">{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="demo-accounts">
          <div className="muted small">Demo accounts (password <code>Password@123</code>)</div>
          {['alice', 'bob', 'carol'].map((u) => (
            <button type="button" key={u} className="chip chip--btn" onClick={() => { setEmail(`${u}@qamart.test`); setPassword('Password@123'); }} data-testid={`demo-${u}`}>{u}@qamart.test</button>
          ))}
        </div>
      </form>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="container page"><div className="card empty"><h2>Page not found</h2><Link to="/" className="btn btn--primary">Go to QAMart home</Link></div></div>
  );
}
