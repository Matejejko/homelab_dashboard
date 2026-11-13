// Per-browser customisation. The keys and shapes are unchanged from the old
// dashboard so an existing layout keeps its groups, overrides and manual pins.

export const LAYOUT_KEY = 'homelab-dashboard-layout';
export const THEME_KEY = 'homelab-theme';

export const PIN_TYPES = ['lan', 'zerotier', 'tailscale', 'wan'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCoord = (value, limit) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

function cleanLocation(value) {
  if (isObject(value) && isCoord(value.lat, 90) && isCoord(value.lng, 180)) {
    return { lat: value.lat, lng: value.lng };
  }
  return { lat: 0, lng: 0 };
}

function cleanPins(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((pin) => isObject(pin) && typeof pin.name === 'string' && isCoord(pin.lat, 90) && isCoord(pin.lng, 180))
    .map((pin) => ({
      name: pin.name,
      lat: pin.lat,
      lng: pin.lng,
      type: PIN_TYPES.includes(pin.type) ? pin.type : 'lan',
    }));
}

function cleanOverrides(value) {
  const out = {};
  if (!isObject(value)) return out;
  for (const [service, override] of Object.entries(value)) {
    if (!isObject(override)) continue;
    const entry = {};
    if (typeof override.name === 'string') entry.name = override.name;
    if (typeof override.icon === 'string') entry.icon = override.icon;
    if (typeof override.desc === 'string') entry.desc = override.desc;
    out[service] = entry;
  }
  return out;
}

function cleanAssignments(value) {
  const out = {};
  if (!isObject(value)) return out;
  for (const [service, group] of Object.entries(value)) {
    if (typeof group === 'string' && group) out[service] = group;
  }
  return out;
}

// `networkConfig` from old layouts is dropped on purpose: server addresses now
// always come from /api/config.
export function normalizeLayout(saved) {
  const source = isObject(saved) ? saved : {};
  return {
    groups: Array.isArray(source.groups)
      ? [...new Set(source.groups.filter((g) => typeof g === 'string' && g))]
      : [],
    assignments: cleanAssignments(source.assignments),
    serviceOverrides: cleanOverrides(source.serviceOverrides),
    serverLocation: cleanLocation(source.serverLocation),
    devices: cleanPins(source.devices),
  };
}

export function loadLayout() {
  try {
    return normalizeLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY)));
  } catch {
    return normalizeLayout(null);
  }
}

export function saveLayout(layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(normalizeLayout(layout)));
  } catch {
    // Storage full or blocked: the layout simply lasts for this page view.
  }
}

export function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // fall through to the OS preference
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

// (0, 0) is the "not set" value in both the layout and /api/config.
export const hasLocation = (loc) => Boolean(loc && (loc.lat || loc.lng));
