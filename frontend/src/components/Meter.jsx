import { loadLevel } from '../format.js';

export default function Meter({ percent, label }) {
  const value = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  return (
    <div
      className={`meter meter--${loadLevel(value)}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <div className="meter__fill" style={{ width: `${value}%` }} />
    </div>
  );
}
