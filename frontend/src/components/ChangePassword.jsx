import { useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';

const MIN = 12;
const MAX = 256;

// Used twice: as the whole page when a change is forced after first login, and
// inside the Settings dialog for a voluntary change.
export default function ChangePassword({ forced = false, onDone, onCancel, onLogout }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (next.length < MIN) return setError(`The new password must be at least ${MIN} characters.`);
    if (next.length > MAX) return setError(`The new password must be at most ${MAX} characters.`);
    if (next === current) return setError('The new password must differ from the current one.');
    if (next !== confirm) return setError('The two new passwords do not match.');

    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (err) {
      if (err.status === 401) return undefined;      // session ended: App shows the login form
      setError(err.status === 429 ? 'Too many failed attempts. Try again later.' : err.message);
      setBusy(false);
    }
    return undefined;
  };

  const form = (
    <form className={forced ? 'auth__card' : 'stack'} onSubmit={submit} aria-labelledby={forced ? 'change-title' : undefined}>
      {forced && (
        <>
          <div className="auth__brand">
            <span className="brand__mark"><Icon name="key" /></span>
            <h1 id="change-title" className="auth__title">Set a new password</h1>
          </div>
          <p className="auth__hint">
            You signed in with the one-time password. Choose your own before the dashboard opens.
          </p>
        </>
      )}

      <label className="field">
        <span className="field__label">Current password</span>
        <input
          className="input"
          name="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoFocus
          required
        />
      </label>
      <label className="field">
        <span className="field__label">New password <span className="field__note">({MIN} to {MAX} characters)</span></span>
        <input
          className="input"
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          minLength={MIN}
          maxLength={MAX}
          required
        />
      </label>
      <label className="field">
        <span className="field__label">Repeat new password</span>
        <input
          className="input"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </label>

      {error && <p className="notice notice--bad" role="alert">{error}</p>}

      <div className="actions">
        {forced && (
          <button type="button" className="btn" onClick={onLogout}>
            <Icon name="logout" /> Sign out
          </button>
        )}
        {!forced && (
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        )}
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </div>
    </form>
  );

  return forced ? <main className="auth">{form}</main> : form;
}
