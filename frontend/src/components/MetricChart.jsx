import { useMemo, useState } from 'react';
import { formatClock } from '../format.js';
import { useElementSize } from '../hooks/useElementSize.js';
import { HISTORY_WINDOW_MS } from '../hooks/useMetricHistory.js';

const GAP_MS = 20000;                 // a longer silence breaks the line instead of bridging it
const PAD = { top: 8, right: 7, bottom: 1, left: 1 };
const TABLE_ROWS = 8;

const fixed = (n) => n.toFixed(1);

// Runs of consecutive samples that have a value and no long gap between them.
function runs(points) {
  const out = [];
  let current = [];
  for (const point of points) {
    const broken = point.v === null
      || (current.length && point.t - current[current.length - 1].t > GAP_MS);
    if (broken && current.length) {
      out.push(current);
      current = [];
    }
    if (point.v !== null) current.push(point);
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * Time on x (the last five minutes, proportional), one shared y scale.
 *
 * Props:
 *   label    what is measured, for the accessible name ("CPU usage")
 *   samples  [{t, [key]: number | null}], oldest first
 *   series   [{key, label, tone: 1 | 2, area?: boolean}]
 *   max      top of the y scale
 *   format   number -> text, used for every value shown
 *   scaleLabel  how to write `max` on the axis (a clean number, e.g. "100%")
 */
export default function MetricChart({ label, samples, series, max, format, scaleLabel }) {
  const [boxRef, { width, height }] = useElementSize();
  const [activeT, setActiveT] = useState(null);       // timestamp under the crosshair

  const end = samples.length ? samples[samples.length - 1].t : 0;
  const start = end - HISTORY_WINDOW_MS;
  const visible = useMemo(() => samples.filter((sample) => sample.t >= start), [samples, start]);

  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = Math.max(height - PAD.top - PAD.bottom, 1);
  const base = PAD.top + plotH;
  const xOf = (t) => PAD.left + ((t - start) / HISTORY_WINDOW_MS) * plotW;
  const yOf = (v) => PAD.top + (1 - Math.min(Math.max(v, 0), max) / max) * plotH;

  const nearest = (t) => {
    let best = -1;
    for (let i = 0; i < visible.length; i += 1) {
      if (best < 0 || Math.abs(visible[i].t - t) < Math.abs(visible[best].t - t)) best = i;
    }
    return best;
  };
  const activeIndex = activeT === null ? -1 : nearest(activeT);
  const active = activeIndex >= 0 ? visible[activeIndex] : null;

  const pointTo = (event) => {
    if (!visible.length || !width) return;
    const box = event.currentTarget.getBoundingClientRect();
    const t = start + ((event.clientX - box.left - PAD.left) / plotW) * HISTORY_WINDOW_MS;
    setActiveT(visible[nearest(t)].t);
  };

  const onKeyDown = (event) => {
    if (!visible.length) return;
    const last = visible.length - 1;
    const from = activeIndex < 0 ? last : activeIndex;
    let to = null;
    if (event.key === 'ArrowLeft') to = Math.max(from - 1, 0);
    else if (event.key === 'ArrowRight') to = Math.min(from + 1, last);
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = last;
    else if (event.key === 'Escape') setActiveT(null);
    if (to !== null) {
      event.preventDefault();
      setActiveT(visible[to].t);
    }
  };

  const drawn = width > 0 && height > 0;
  const shapes = drawn
    ? series.map((item) => ({
      ...item,
      runs: runs(visible.map((sample) => ({ t: sample.t, v: sample[item.key] ?? null }))),
    }))
    : [];

  const summary = series.map((item) => {
    const values = visible.map((sample) => sample[item.key]).filter((v) => v !== null && v !== undefined);
    if (!values.length) return `${item.label}: no data yet`;
    return `${item.label}: now ${format(values[values.length - 1])}, low ${format(Math.min(...values))}, high ${format(Math.max(...values))}`;
  }).join('. ');

  const cx = active ? xOf(active.t) : 0;
  const tipSide = cx > width / 2 ? { right: width - cx + 10 } : { left: cx + 10 };

  return (
    <div className="chartbox">
      <div
        ref={boxRef}
        className="chart"
        role="group"
        aria-roledescription="chart"
        aria-label={`${label}, last 5 minutes. ${summary}. Arrow keys read single values.`}
        tabIndex={0}
        onPointerMove={pointTo}
        onPointerDown={pointTo}
        onPointerLeave={() => setActiveT(null)}
        onFocus={() => setActiveT((t) => (t === null && visible.length ? visible[visible.length - 1].t : t))}
        onBlur={() => setActiveT(null)}
        onKeyDown={onKeyDown}
      >
        {drawn && (
          <svg className="chart__svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            <line className="chart__grid" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + 0.5} y2={PAD.top + 0.5} />
            <line className="chart__grid" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH / 2} y2={PAD.top + plotH / 2} />
            <line className="chart__grid" x1={PAD.left} x2={width - PAD.right} y1={base - 0.5} y2={base - 0.5} />

            {shapes.map((item) => item.runs.map((run) => {
              const first = run[0];
              const last = run[run.length - 1];
              const line = run.map((p, i) => `${i ? 'L' : 'M'}${fixed(xOf(p.t))},${fixed(yOf(p.v))}`).join(' ');
              return (
                <g key={`${item.key}:${first.t}`} className={`tone-${item.tone}`}>
                  {item.area && run.length > 1 && (
                    <path className="chart__area" d={`${line} L${fixed(xOf(last.t))},${base} L${fixed(xOf(first.t))},${base} Z`} />
                  )}
                  {run.length > 1
                    ? <path className="chart__line" d={line} />
                    : <circle className="chart__lone" cx={xOf(first.t)} cy={yOf(first.v)} r="2" />}
                </g>
              );
            }))}

            {active && (
              <>
                <line className="chart__cross" x1={cx} x2={cx} y1={PAD.top} y2={base} />
                {series.map((item) => (active[item.key] === null || active[item.key] === undefined ? null : (
                  <circle key={item.key} className={`chart__dot tone-${item.tone}`} cx={cx} cy={yOf(active[item.key])} r="4" />
                )))}
              </>
            )}
          </svg>
        )}

        <span className="chart__scale">{scaleLabel || format(max)}</span>

        {active && (
          <div className="chart__tip" style={tipSide} role="status">
            <div className="chart__tip-time">{formatClock(active.t)}</div>
            {series.map((item) => (
              <div key={item.key} className="chart__tip-row">
                <span className={`linekey tone-${item.tone}`} aria-hidden="true" />
                <strong>{active[item.key] === null || active[item.key] === undefined ? '–' : format(active[item.key])}</strong>
                <span className="chart__tip-label">{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="chart__axis" aria-hidden="true">
        <span>5 min ago</span>
        <span>now</span>
      </div>

      {/* The same numbers without the picture or the pointer. */}
      <table className="sr-only">
        <caption>{label}, most recent samples</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            {series.map((item) => <th key={item.key} scope="col">{item.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {visible.slice(-TABLE_ROWS).map((sample) => (
            <tr key={sample.t}>
              <th scope="row">{formatClock(sample.t)}</th>
              {series.map((item) => (
                <td key={item.key}>{sample[item.key] === null || sample[item.key] === undefined ? '–' : format(sample[item.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
