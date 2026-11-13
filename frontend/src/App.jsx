import { useCallback, useEffect, useState } from 'react';
import { api, onAuthEvents } from './api.js';
import ChangePassword from './components/ChangePassword.jsx';
import Dashboard from './components/Dashboard.jsx';
import Login from './components/Login.jsx';
import { useTheme } from './hooks/useTheme.js';

const SIGNED_OUT = { authenticated: false, username: null, must_change_password: false };

// Three exclusive screens: login, forced password change, dashboard.
export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [session, setSession] = useState(null);       // null until the first answer
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.session());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Any 401 from any call returns to the login form.
    return onAuthEvents({
      unauthorized: () => setSession(SIGNED_OUT),
      passwordChangeRequired: () => setSession((prev) => (
        prev && prev.authenticated ? { ...prev, must_change_password: true } : prev
      )),
    });
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Signed out locally either way; the server session expires on its own.
    }
    setSession(SIGNED_OUT);
  }, []);

  if (session === null) {
    return (
      <main className="auth">
        <div className="auth__card auth__card--plain" role="status">
          {error ? (
            <>
              <p className="notice notice--bad">{error}</p>
              <button type="button" className="btn btn--primary" onClick={refresh}>Retry</button>
            </>
          ) : (
            <p className="auth__hint">Connecting…</p>
          )}
        </div>
      </main>
    );
  }

  if (!session.authenticated) return <Login onSuccess={refresh} />;
  if (session.must_change_password) return <ChangePassword forced onDone={refresh} onLogout={logout} />;
  return <Dashboard theme={theme} onToggleTheme={toggleTheme} onLogout={logout} />;
}
