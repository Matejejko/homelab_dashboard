import { useEffect, useRef, useState } from 'react';

export const HISTORY_WINDOW_MS = 5 * 60 * 1000;

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// The last five minutes of /api/system, kept in the browser. The backend stores
// no history, so the graphs start empty after a reload and fill as polls arrive.
export function useMetricHistory(system) {
  const [samples, setSamples] = useState([]);
  const lastSource = useRef(null);

  useEffect(() => {
    if (!system || typeof system !== 'object' || system === lastSource.current) return;
    lastSource.current = system;
    const sample = {
      t: Date.now(),
      cpu: number(system.cpu && system.cpu.percent),
      ram: number(system.ram && system.ram.percent),
      rx: number(system.network && system.network.rx_mb_s),
      tx: number(system.network && system.network.tx_mb_s),
    };
    setSamples((previous) => [
      ...previous.filter((old) => sample.t - old.t <= HISTORY_WINDOW_MS + 15000),
      sample,
    ]);
  }, [system]);

  return samples;
}
