import { useEffect, useState } from 'react';

// Owns its own one-second tick, so nothing else re-renders with it.
export default function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <time className="clock" dateTime={now.toISOString()}>
      {now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
      {now.toLocaleTimeString()}
    </time>
  );
}
