import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Polls `path` while the calling component is mounted. Requests never overlap,
// and a response identical to the previous one does not trigger a re-render,
// so unchanged data leaves the DOM (and the map) alone.
export function usePolling(path, intervalMs) {
  const [state, setState] = useState({ data: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    let timer = null;
    let stopped = false;
    let lastJson = null;

    const tick = async () => {
      try {
        const data = await api.get(path, controller.signal);
        if (stopped) return;
        const json = JSON.stringify(data);
        if (json !== lastJson) {
          lastJson = json;
          setState({ data, error: null });
        } else {
          setState((prev) => (prev.error ? { data: prev.data, error: null } : prev));
        }
      } catch (err) {
        if (stopped || err.name === 'AbortError') return;
        setState((prev) => (prev.error === err.message ? prev : { data: prev.data, error: err.message }));
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };

    tick();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, intervalMs]);

  return state;
}
