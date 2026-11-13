import { formatPercent, formatRate, niceCeil } from '../format.js';
import Meter from './Meter.jsx';
import MetricCard from './MetricCard.jsx';
import MetricChart from './MetricChart.jsx';
import Stat from './Stat.jsx';
import StorageCard from './StorageCard.jsx';

const CPU_SERIES = [{ key: 'cpu', label: 'CPU', tone: 1, area: true }];
const RAM_SERIES = [{ key: 'ram', label: 'RAM', tone: 1, area: true }];
// Both in MB/s on one shared scale: down as the filled area, up as a line.
const NET_SERIES = [
  { key: 'rx', label: 'down', tone: 1, area: true },
  { key: 'tx', label: 'up', tone: 2 },
];

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const fixed = (value, digits) => (isNumber(value) ? value.toFixed(digits) : '–');
const plain = (value) => (isNumber(value) ? value : '–');
const isObject = (value) => value !== null && typeof value === 'object';

// A response that is not shaped like /api/system is treated as "no data",
// never as something to render.
const usable = (system) =>
  isObject(system) && isObject(system.cpu) && isObject(system.ram) && isObject(system.uptime) && isObject(system.network);

export default function StatStrip({ system, history, error }) {
  const ready = usable(system);
  const blank = error || system ? 'n/a' : '…';
  const cpu = ready ? system.cpu : {};
  const ram = ready ? system.ram : {};
  const network = ready ? system.network : {};
  const uptime = ready ? system.uptime : {};
  const temp = ready ? system.temp_c : null;
  const disks = ready && Array.isArray(system.disks) ? system.disks.filter(isObject) : [];
  const load = Array.isArray(cpu.load_avg) ? cpu.load_avg[0] : undefined;

  // The network scale follows the busiest moment on screen, rounded up to a clean number.
  const peak = history.reduce((top, sample) => Math.max(top, sample.rx || 0, sample.tx || 0), 0);
  const netMax = niceCeil(Math.max(peak, 0.01));

  // "Intel Core i5-6500T CPU @ 2.50GHz" -> "Intel Core i5-6500T": the live
  // frequency is shown next to it, the full name stays in the tooltip.
  const model = typeof cpu.model === 'string' ? cpu.model : '';
  const shortModel = model.replace(/\s+(CPU|Processor)\s*@.*$/i, '').trim();
  const cpuFacts = [
    isNumber(cpu.cores) && isNumber(cpu.threads) ? `${cpu.cores} cores · ${cpu.threads} threads` : null,
    isNumber(cpu.freq_mhz) ? `${(cpu.freq_mhz / 1000).toFixed(2)} GHz` : null,
    isNumber(load) ? `load ${load}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="system" aria-busy={!ready && !error}>
      <div className="metrics">
        <MetricCard
          icon="cpu"
          label="CPU"
          value={ready ? formatPercent(cpu.percent) : blank}
          sub={shortModel || cpuFacts}
          subTitle={model}
          side={shortModel ? cpuFacts : ''}
        >
          <MetricChart label="CPU usage" samples={history} series={CPU_SERIES} max={100} format={formatPercent} scaleLabel="100%" />
        </MetricCard>

        <MetricCard
          icon="memory"
          label="RAM"
          value={ready ? formatPercent(ram.percent) : blank}
          sub={ready ? `${fixed(ram.used_gb, 1)} / ${fixed(ram.total_gb, 1)} GB` : ''}
          side={ready ? `${fixed(ram.free_gb, 1)} GB free` : ''}
        >
          <MetricChart label="Memory usage" samples={history} series={RAM_SERIES} max={100} format={formatPercent} scaleLabel="100%" />
        </MetricCard>

        <MetricCard
          icon="network"
          label="Network"
          value={ready ? (
            <>
              <span className="metric__pair">
                <span className="linekey tone-1" aria-hidden="true" />
                <span aria-hidden="true">↓</span><span className="sr-only">down </span>
                {formatRate(network.rx_mb_s)}
              </span>
              <span className="metric__pair">
                <span className="linekey tone-2" aria-hidden="true" />
                <span aria-hidden="true">↑</span><span className="sr-only">up </span>
                {formatRate(network.tx_mb_s)}
              </span>
            </>
          ) : blank}
          sub={ready ? (typeof network.iface === 'string' && network.iface ? network.iface : 'all interfaces') : ''}
        >
          <MetricChart
            label="Network throughput"
            samples={history}
            series={NET_SERIES}
            max={netMax}
            format={formatRate}
            scaleLabel={formatRate(netMax).replace(/\.0+(?=\s)/, '')}
          />
        </MetricCard>
      </div>

      <div className="system__row">
        <StorageCard disks={disks} pending={!ready && !error} />

        <div className="ministats">
          <Stat label="Temp" icon="temperature">
            {isNumber(temp) ? (
              <>
                <p className="stat__value">{temp}<span className="stat__unit">°C</span></p>
                <Meter percent={temp} label="Temperature" />
              </>
            ) : (
              <p className="stat__value stat__value--empty">{ready ? 'n/a' : blank}</p>
            )}
          </Stat>

          <Stat label="Uptime" icon="clock">
            {ready ? (
              <p className="stat__value">
                {plain(uptime.days)}<span className="stat__unit">d</span> {plain(uptime.hours)}<span className="stat__unit">h</span>{' '}
                {plain(uptime.minutes)}<span className="stat__unit">m</span>
              </p>
            ) : (
              <p className="stat__value stat__value--empty">{blank}</p>
            )}
          </Stat>
        </div>
      </div>
    </div>
  );
}
