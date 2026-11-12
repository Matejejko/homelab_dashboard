import Meter from './Meter.jsx';
import Stat from './Stat.jsx';

const LABELS = ['CPU', 'RAM', 'Temp', 'Uptime', 'Net I/O', 'Disks'];

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const fixed = (value, digits) => (isNumber(value) ? value.toFixed(digits) : '–');
const plain = (value) => (isNumber(value) ? value : '–');
const isObject = (value) => value !== null && typeof value === 'object';

// A response that is not shaped like /api/system is treated as "no data",
// never as something to render.
const usable = (system) =>
  isObject(system) && isObject(system.cpu) && isObject(system.ram) && isObject(system.uptime) && isObject(system.network);

export default function StatStrip({ system, error }) {
  if (!usable(system)) {
    return (
      <div className="stats" aria-busy={!error && !system}>
        {LABELS.map((label) => (
          <Stat key={label} label={label}>
            <p className="stat__value stat__value--empty">{error || system ? 'n/a' : '…'}</p>
          </Stat>
        ))}
      </div>
    );
  }

  const { cpu, ram, temp_c: temp, uptime, network } = system;
  const disks = Array.isArray(system.disks) ? system.disks.filter(isObject) : [];
  const load = Array.isArray(cpu.load_avg) ? cpu.load_avg[0] : undefined;
  return (
    <div className="stats">
      <Stat label="CPU">
        <p className="stat__value">{fixed(cpu.percent, 1)}<span className="stat__unit">%</span></p>
        <Meter percent={cpu.percent} label="CPU usage" />
        <p className="stat__sub">
          {plain(cpu.cores)}c/{plain(cpu.threads)}t
          {isNumber(cpu.freq_mhz) ? ` · ${(cpu.freq_mhz / 1000).toFixed(2)} GHz` : ''} · load {plain(load)}
        </p>
      </Stat>

      <Stat label="RAM">
        <p className="stat__value">
          {fixed(ram.used_gb, 1)}<span className="stat__unit">/ {fixed(ram.total_gb, 1)} GB</span>
        </p>
        <Meter percent={ram.percent} label="Memory usage" />
        <p className="stat__sub">{fixed(ram.percent, 0)}% used · {fixed(ram.free_gb, 1)} GB free</p>
      </Stat>

      <Stat label="Temp">
        {isNumber(temp) ? (
          <>
            <p className="stat__value">{temp}<span className="stat__unit">°C</span></p>
            <Meter percent={temp} label="Temperature" />
          </>
        ) : (
          <p className="stat__value stat__value--empty">n/a</p>
        )}
      </Stat>

      <Stat label="Uptime">
        <p className="stat__value">
          {plain(uptime.days)}<span className="stat__unit">d</span> {plain(uptime.hours)}<span className="stat__unit">h</span>{' '}
          {plain(uptime.minutes)}<span className="stat__unit">m</span>
        </p>
      </Stat>

      <Stat label="Net I/O">
        <p className="stat__value stat__value--pair">
          <span><span className="stat__arrow" aria-hidden="true">↓</span><span className="sr-only">received </span>{plain(network.rx_mb_s)}</span>
          <span><span className="stat__arrow" aria-hidden="true">↑</span><span className="sr-only">sent </span>{plain(network.tx_mb_s)}</span>
        </p>
        <p className="stat__sub">MB/s down · up</p>
      </Stat>

      <Stat label={`Disks · ${disks.length}`}>
        {disks.length === 0 && <p className="stat__sub">No disks found</p>}
        <ul className="disks">
          {disks.map((disk) => (
            <li key={`${disk.device}:${disk.mount}`} className="disk" title={`${disk.device} (${disk.fstype})`}>
              <span className="disk__mount">{String(disk.mount)}</span>
              <Meter percent={disk.pct} label={`${disk.mount} usage`} />
              <span className="disk__size">{plain(disk.used_gb)}/{plain(disk.total_gb)}G</span>
            </li>
          ))}
        </ul>
      </Stat>
    </div>
  );
}
