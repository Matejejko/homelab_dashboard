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
