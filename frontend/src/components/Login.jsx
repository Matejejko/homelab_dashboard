import { useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';

export default function Login({ onSuccess }) {
  const [username, setUsername] = useState('admin');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(username, secret);
      onSuccess();
    } catch (err) {
      if (err.status === 429) {
        const wait = err.retryAfter ? ` Try again in ${err.retryAfter} s.` : ' Try again later.';
        setError(`Too many failed logins.${wait}`);
      } else if (err.status === 401) {
        setError('Invalid username or password.');
      } else {
        setError(err.message);
      }
      setSecret('');
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <form className="auth__card" onSubmit={submit} aria-labelledby="login-title">
        <div className="auth__brand">
          <span className="brand__mark"><Icon name="server" /></span>
          <h1 id="login-title" className="auth__title">homelab<span className="brand__dim">/dashboard</span></h1>
        </div>
        <p className="auth__hint">Sign in to continue.</p>

        <label className="field">
          <span className="field__label">Username</span>
          <input
            className="input"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="input"
            name="password"
            type="password"
            autoComplete="current-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoFocus
            required
          />
        </label>

        {error && <p className="notice notice--bad" role="alert">{error}</p>}

        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          <Icon name="lock" /> {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
