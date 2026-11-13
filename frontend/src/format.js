export function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1000;
    unit += 1;
  } while (value >= 1000 && unit < units.length - 1);
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export const NET_LABELS = { lan: 'LAN', tailscale: 'Tailscale', zerotier: 'ZeroTier', wan: 'WAN' };

// Direction is always spelled out next to its arrow, never shown by colour alone.
export const DIRECTIONS = {
  in: { arrow: '↓', short: 'in', long: 'inbound, toward the server' },
  out: { arrow: '↑', short: 'out', long: 'outbound, from the server' },
  both: { arrow: '↕', short: 'both', long: 'inbound and outbound' },
};

export const REASONS = {
  pending: 'geolocation pending',
  lookup_failed: 'geolocation failed',
  relayed: 'relayed, no direct endpoint',
  private: 'private address',
  no_server_location: 'server location not set',
};

export const reasonText = (reason) => REASONS[reason] || 'location unknown';

export function placeText(geo) {
  if (!geo) return '';
  return [geo.city, geo.country].filter(Boolean).join(', ');
}

// Only http(s) URLs ever become links, whatever a label or annotation said.
export function safeHref(url) {
  if (typeof url !== 'string' || !url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function loadLevel(percent) {
  if (percent > 85) return 'bad';
  if (percent > 65) return 'warn';
  return 'ok';
}

// /api/system reports MB/s; show kB/s below 1 MB/s, as people read throughput.
export function formatRate(mbPerSecond) {
  if (typeof mbPerSecond !== 'number' || !Number.isFinite(mbPerSecond)) return '–';
  if (mbPerSecond >= 1) {
    const digits = mbPerSecond >= 100 ? 0 : mbPerSecond >= 10 ? 1 : 2;
    return `${mbPerSecond.toFixed(digits)} MB/s`;
  }
  const kb = mbPerSecond * 1000;
  return `${kb >= 100 ? kb.toFixed(0) : kb.toFixed(1)} kB/s`;
}

export const formatPercent = (value) =>
  (typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '–');

// Smallest of 1, 2, 5 x 10^n that is not below `value`: a clean top for a y scale.
export function niceCeil(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return step * magnitude;
}

export function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
