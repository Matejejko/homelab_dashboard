// Thin fetch wrapper for the same-origin /api. The session lives in an HttpOnly
// cookie, so there is nothing to attach here and nothing a script could steal.

export class ApiError extends Error {
  constructor(status, message, code, retryAfter) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || null;
    this.retryAfter = retryAfter || null;
  }
}

const listeners = { unauthorized: null, passwordChangeRequired: null };

// App registers these once: any 401 returns to the login form, and a 403 that
// asks for a password change shows that form.
export function onAuthEvents({ unauthorized, passwordChangeRequired }) {
  listeners.unauthorized = unauthorized;
  listeners.passwordChangeRequired = passwordChangeRequired;
  return () => {
    listeners.unauthorized = null;
    listeners.passwordChangeRequired = null;
  };
}

async function request(path, { method = 'GET', body, signal, quiet401 = false } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'The server cannot be reached.');
  }

  if (response.status === 204) return null;

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail = data && typeof data.detail === 'string' ? data.detail : `HTTP ${response.status}`;
    const code = data && typeof data.code === 'string' ? data.code : null;
    const retryAfter = Number.parseInt(response.headers.get('Retry-After') || '', 10) || null;
    if (response.status === 401 && !quiet401 && listeners.unauthorized) listeners.unauthorized();
    if (response.status === 403 && code === 'password_change_required' && listeners.passwordChangeRequired) {
      listeners.passwordChangeRequired();
    }
    throw new ApiError(response.status, detail, code, retryAfter);
  }
  return data;
}

export const api = {
  get: (path, signal) => request(path, { signal }),
  session: (signal) => request('/api/auth/session', { signal }),
  // A 401 here means "wrong credentials", not "session expired".
  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', body: { username, password }, quiet401: true }),
  logout: () => request('/api/auth/logout', { method: 'POST', quiet401: true }),
  changePassword: (currentPassword, newPassword) =>
    request('/api/auth/password', {
      method: 'POST',
      body: { current_password: currentPassword, new_password: newPassword },
    }),
};
