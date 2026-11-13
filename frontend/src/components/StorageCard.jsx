import Icon from './Icon.jsx';
import Meter from './Meter.jsx';

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const size = (gb) => {
  if (!isNumber(gb)) return '–';
  return gb >= 1000 ? `${(gb / 1000).toFixed(2)} TB` : `${gb.toFixed(1)} GB`;
};

// Every filesystem gets a row of its own with room to read it.
export default function StorageCard({ disks, pending }) {
  const used = disks.reduce((sum, disk) => sum + (isNumber(disk.used_gb) ? disk.used_gb : 0), 0);
  const total = disks.reduce((sum, disk) => sum + (isNumber(disk.total_gb) ? disk.total_gb : 0), 0);

  return (
    <section className="storage" aria-label="Storage">
      <header className="metric__head">
        <h3 className="metric__label">
          <Icon name="disk" /> Storage <span className="count">{disks.length}</span>
        </h3>
        {disks.length > 0 && <div className="storage__total">{size(used)} of {size(total)} used</div>}
      </header>

      {disks.length === 0 && <p className="storage__empty">{pending ? '…' : 'No disks found'}</p>}

      <ul className="storage__list">
        {disks.map((disk) => (
          <li key={`${disk.device}:${disk.mount}`} className="volume">
            <div className="volume__top">
              <span className="volume__mount">{String(disk.mount)}</span>
              <span className="volume__pct">{isNumber(disk.pct) ? `${disk.pct.toFixed(0)}%` : '–'}</span>
            </div>
            <Meter percent={disk.pct} label={`${disk.mount} usage`} large />
            <div className="volume__meta">
              <span>{size(disk.used_gb)} of {size(disk.total_gb)} · {size(disk.free_gb)} free</span>
              <span className="volume__device">{String(disk.device)} · {String(disk.fstype)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
