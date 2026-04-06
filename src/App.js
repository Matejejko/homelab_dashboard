import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

// ── Hooks ─────────────────────────────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

const THEME_KEY = 'homelab-theme';
function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  const toggle = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);
  return [theme, toggle];
}

// ── Constants ─────────────────────────────────────────────────────────────
const API = process.env.REACT_APP_API_URL || '';
const LS_KEY = 'homelab-dashboard-layout';

// ── Persistence ───────────────────────────────────────────────────────────
function loadLayout() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function saveLayout(l) { localStorage.setItem(LS_KEY, JSON.stringify(l)); }

// ── Helpers ───────────────────────────────────────────────────────────────
function barColor(pct) {
  if (pct > 85) return '#ef4444';
  if (pct > 65) return '#f59e0b';
  return '#10b981';
}

const TYPE_COLORS = { lan: '#60a5fa', zerotier: '#f59e0b', tailscale: '#a78bfa', wan: '#f59e0b' };

// ── Inline Styles (using CSS variables for theming) ───────────────────────
const S = {
  app: {
    minHeight: '100vh', padding: '28px 32px 48px', maxWidth: '1440px', margin: '0 auto',
    fontFamily: 'var(--font)', color: 'var(--text-primary)',
  },
  // Header
  header: {
    display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px',
    flexWrap: 'wrap', paddingBottom: '20px', borderBottom: '1px solid var(--border)',
  },
  logoMark: {
    width: '36px', height: '36px', borderRadius: '10px',
    background: 'linear-gradient(135deg, var(--accent), #a78bfa)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '1.1rem', color: '#fff', fontWeight: 700, flexShrink: 0,
  },
  h1: { fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' },
  subtitle: { fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' },
  headerRight: { marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' },
  clock: { fontSize: '0.82rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--mono)', letterSpacing: '-0.01em' },

  // Buttons
  btn: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px',
    padding: '7px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.78rem',
    fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '5px',
    transition: 'all 0.15s', fontFamily: 'var(--font)',
  },
  btnHover: { background: 'var(--bg-hover)', borderColor: 'var(--border-hover)', color: 'var(--text-primary)' },
  btnPrimary: { background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff' },

  // Cards
  card: {
    background: 'var(--bg-surface)', borderRadius: '14px', padding: '20px',
    border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
  },
  cardLabel: {
    fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px',
    display: 'flex', alignItems: 'center', gap: '6px',
  },
  cardDot: { width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0 },
  bigNum: { fontSize: '2rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.03em', lineHeight: 1 },
  bigUnit: { fontSize: '0.85rem', color: 'var(--text-secondary)', marginLeft: '3px', fontWeight: 500 },
  sub: { fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.4 },

  // Progress bar
  barOuter: { height: '6px', borderRadius: '3px', background: 'var(--bar-track)', marginTop: '12px', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: '3px', transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)' },

  // Grid
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '14px', marginBottom: '36px' },

  // Groups
  groupHeader: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', marginTop: '24px' },
  groupTitle: { fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', letterSpacing: '-0.01em' },
  groupTitleInput: {
    fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)',
    background: 'var(--bg-elevated)', border: '1px solid var(--accent)', borderRadius: '6px',
    padding: '3px 10px', outline: 'none', fontFamily: 'var(--font)',
  },
  groupBadge: {
    fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)',
    background: 'var(--bg-elevated)', borderRadius: '10px', padding: '2px 8px',
  },
  groupDelete: {
    marginLeft: 'auto', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.72rem',
    padding: '3px 8px', borderRadius: '6px', border: '1px solid transparent',
    background: 'transparent', transition: 'all 0.15s', fontFamily: 'var(--font)',
  },

  // Service cards
  svcCard: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px',
    padding: '14px', cursor: 'grab', userSelect: 'none', boxShadow: 'var(--shadow-sm)',
  },
  svcTop: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  svcIcon: { fontSize: '1.15rem' },
  svcName: { fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', letterSpacing: '-0.01em' },
  svcDesc: { fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '6px', lineHeight: 1.4 },
  statusDot: (online) => ({
    width: '8px', height: '8px', borderRadius: '50%', marginLeft: 'auto', flexShrink: 0,
    background: online ? 'var(--success)' : 'var(--danger)',
    boxShadow: online ? '0 0 6px var(--success)' : '0 0 6px var(--danger)',
  }),
  ping: { fontSize: '0.66rem', color: 'var(--text-muted)' },
  svcBtns: { display: 'flex', gap: '5px', marginTop: '10px', flexWrap: 'wrap' },
  svcPort: { fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' },
  editBtn: {
    background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
    fontSize: '0.72rem', padding: '2px 5px', borderRadius: '4px', marginLeft: '2px',
    transition: 'color 0.15s',
  },

  // Access buttons
  lanPill: { background: 'rgba(96,165,250,0.12)', color: '#60a5fa', borderColor: 'rgba(96,165,250,0.2)' },
  ztPill:  { background: 'rgba(245,158,11,0.12)', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.2)' },
  tsPill:  { background: 'rgba(167,139,250,0.12)', color: '#a78bfa', borderColor: 'rgba(167,139,250,0.2)' },
  pillDisabled: { opacity: 0.3, cursor: 'default' },

  // Network info
  netInfoRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' },
  netInfoLabel: { fontSize: '0.7rem', fontWeight: 600, minWidth: '68px' },
  netInfoVal: { fontSize: '0.8rem', color: 'var(--text-primary)', fontFamily: 'var(--mono)' },
  netInfoNone: { fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' },

  // Disk
  diskRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
  diskLabel: { fontSize: '0.72rem', color: 'var(--text-secondary)', minWidth: '50px', fontFamily: 'var(--mono)' },
  diskPct: { fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto', minWidth: '50px', textAlign: 'right', fontFamily: 'var(--mono)' },

  // Modal
  modalTitle: { fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '20px', letterSpacing: '-0.01em' },
  sectionLabel: { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '20px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' },
  label: { display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '5px', marginTop: '12px', fontWeight: 500 },
  input: {
    width: '100%', padding: '9px 12px', background: 'var(--input-bg)', border: '1px solid var(--border)',
    borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none',
    boxSizing: 'border-box', fontFamily: 'var(--font)', transition: 'border-color 0.15s',
  },
  error: {
    background: 'var(--danger-dim)', border: '1px solid var(--danger)', borderRadius: '10px',
    padding: '12px 16px', color: 'var(--danger)', fontSize: '0.8rem', marginBottom: '16px',
  },
};

// ── Loading Screen ────────────────────────────────────────────────────────
function LoadingDots() {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500);
    return () => clearInterval(t);
  }, []);
  return <span style={{ display: 'inline-block', width: '1.2em', textAlign: 'left' }}>{dots}</span>;
}

function LoadingScreen({ visible }) {
  return (
    <div className={`loading-screen ${!visible ? 'fade-out' : ''}`}>
      <div className="loading-rack">
        <div className="loading-slot">
          <div className="loading-led green" />
          <div className="loading-led blue" />
          <div className="loading-drive" />
        </div>
        <div className="loading-slot">
          <div className="loading-led green" />
          <div className="loading-led amber" />
          <div className="loading-drive" />
        </div>
        <div className="loading-slot">
          <div className="loading-led blue" />
          <div className="loading-led amber" />
          <div className="loading-drive" />
        </div>
        <div className="loading-power" />
      </div>
      <div className="loading-title">Homelab Dashboard</div>
      <div className="loading-sub">Connecting<LoadingDots /></div>
    </div>
  );
}

// ── Progress Bar ──────────────────────────────────────────────────────────
function Bar({ pct }) {
  const color = barColor(pct);
  return (
    <div style={S.barOuter}>
      <div style={{ ...S.barFill, width: `${Math.min(pct, 100)}%`, background: `linear-gradient(90deg, ${color}cc, ${color})` }} />
    </div>
  );
}

// ── Stat Cards ────────────────────────────────────────────────────────────
function StatCard({ label, dotColor, children }) {
  return (
    <div className="stat-card" style={S.card}>
      <div style={S.cardLabel}>
        {dotColor && <span style={{ ...S.cardDot, background: dotColor }} />}
        {label}
      </div>
      {children}
    </div>
  );
}

function CpuCard({ cpu }) {
  return (
    <StatCard label="CPU" dotColor="var(--accent)">
      <span style={S.bigNum}>{cpu.percent.toFixed(1)}</span><span style={S.bigUnit}>%</span>
      <Bar pct={cpu.percent} />
      <div style={S.sub}>{cpu.cores}c / {cpu.threads}t{cpu.freq_mhz ? ` · ${(cpu.freq_mhz / 1000).toFixed(2)} GHz` : ''}</div>
      <div style={S.sub}>Load: {cpu.load_avg.join(' · ')}</div>
    </StatCard>
  );
}

function RamCard({ ram }) {
  return (
    <StatCard label="Memory" dotColor="var(--info)">
      <span style={S.bigNum}>{ram.used_gb.toFixed(1)}</span><span style={S.bigUnit}>/ {ram.total_gb.toFixed(1)} GB</span>
      <Bar pct={ram.percent} />
      <div style={S.sub}>{ram.percent.toFixed(1)}% used · {ram.free_gb.toFixed(1)} GB free</div>
    </StatCard>
  );
}

function TempCard({ temp }) {
  return (
    <StatCard label="Temperature" dotColor="var(--warning)">
      {temp != null
        ? <><span style={S.bigNum}>{temp}</span><span style={S.bigUnit}>°C</span><Bar pct={temp} /></>
        : <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '8px' }}>Not available</div>}
    </StatCard>
  );
}

function UptimeCard({ uptime }) {
  return (
    <StatCard label="Uptime" dotColor="var(--success)">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px' }}>
        <span style={S.bigNum}>{uptime.days}</span><span style={S.bigUnit}>d </span>
        <span style={{ ...S.bigNum, fontSize: '1.6rem' }}>{uptime.hours}</span><span style={S.bigUnit}>h </span>
        <span style={{ ...S.bigNum, fontSize: '1.6rem' }}>{uptime.minutes}</span><span style={S.bigUnit}>m</span>
      </div>
    </StatCard>
  );
}

function NetworkCard({ net }) {
  return (
    <StatCard label="Network I/O" dotColor="#60a5fa">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
        <div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            <span style={{ color: 'var(--success)', fontSize: '0.9rem', marginRight: '3px' }}>&#8595;</span>{net.rx_mb_s}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>MB/s recv</div>
        </div>
        <div style={{ width: '1px', height: '28px', background: 'var(--border)' }} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            {net.tx_mb_s}<span style={{ color: 'var(--accent)', fontSize: '0.9rem', marginLeft: '3px' }}>&#8593;</span>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>MB/s sent</div>
        </div>
      </div>
    </StatCard>
  );
}

function DisksCard({ disks }) {
  return (
    <StatCard label={`Disks (${disks.length})`} dotColor="#a78bfa">
      {disks.map((d, i) => (
        <div key={i} style={S.diskRow}>
          <div style={S.diskLabel} title={d.device}>{d.mount}</div>
          <div style={{ flex: 1 }}><Bar pct={d.pct} /></div>
          <div style={S.diskPct}>{d.used_gb}/{d.total_gb}G</div>
        </div>
      ))}
      {disks.length === 0 && <div style={S.sub}>No disks found</div>}
    </StatCard>
  );
}

function NetInfoCard({ netCfg, onOpenSettings }) {
  const entries = [
    { label: 'LAN', ip: netCfg.lanIp, color: '#60a5fa' },
    { label: 'ZeroTier', ip: netCfg.ztIp, color: '#f59e0b' },
    { label: 'Tailscale', ip: netCfg.tsIp, color: '#a78bfa' },
  ];
  return (
    <StatCard label="Network IPs">
      {entries.map(e => (
        <div key={e.label} style={S.netInfoRow}>
          <span style={{ ...S.netInfoLabel, color: e.color }}>{e.label}</span>
          {e.ip ? <span style={S.netInfoVal}>{e.ip}</span> : <span style={S.netInfoNone}>not set</span>}
        </div>
      ))}
      <div style={{ marginTop: '10px' }}>
        <button style={{ ...S.btn, fontSize: '0.7rem', padding: '5px 12px' }} onClick={onOpenSettings}>Edit IPs</button>
      </div>
    </StatCard>
  );
}

// ── World Map ─────────────────────────────────────────────────────────────
function WorldMap({ serverLoc, devices, theme }) {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const layerRef = useRef(null);
  const tileRef = useRef(null);

  // Init map once
  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: true })
      .setView([serverLoc.lat || 30, serverLoc.lng || 0], serverLoc.lat ? 4 : 2);
    const tileUrl = theme === 'light'
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    tileRef.current = L.tileLayer(tileUrl, { attribution: 'CartoDB', subdomains: 'abcd', maxZoom: 19 }).addTo(map);
    mapInst.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapInst.current = null; };
  }, []);

  // Update tile layer when theme changes
  useEffect(() => {
    if (!tileRef.current) return;
    const tileUrl = theme === 'light'
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    tileRef.current.setUrl(tileUrl);
  }, [theme]);

  // Update markers when data changes
  useEffect(() => {
    const L = window.L;
    if (!L || !mapInst.current || !layerRef.current) return;
    layerRef.current.clearLayers();

    const sLat = serverLoc.lat, sLng = serverLoc.lng;
    if (sLat || sLng) {
      const serverIcon = L.divIcon({ className: '', html: '<div style="width:14px;height:14px;background:#10b981;border:2px solid #fff;border-radius:50%;box-shadow:0 0 10px #10b981"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
      L.marker([sLat, sLng], { icon: serverIcon }).addTo(layerRef.current).bindPopup('<b>Server</b>');
    }

    (devices || []).forEach(d => {
      if (!d.lat && !d.lng) return;
      const color = TYPE_COLORS[d.type] || '#94a3b8';
      const devIcon = L.divIcon({ className: '', html: `<div style="width:10px;height:10px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 0 8px ${color}"></div>`, iconSize: [10, 10], iconAnchor: [5, 5] });
      L.marker([d.lat, d.lng], { icon: devIcon }).addTo(layerRef.current).bindPopup(`<b>${d.name}</b><br/>${d.type}`);
      if (sLat || sLng) {
        L.polyline([[sLat, sLng], [d.lat, d.lng]], { color, weight: 1.5, opacity: 0.35, dashArray: '6 4' }).addTo(layerRef.current);
      }
    });
  }, [serverLoc, devices]);

  return <div ref={mapRef} style={{ height: '100%', minHeight: '400px', borderRadius: '12px', border: '1px solid var(--border)' }} />;
}

// ── Device List ───────────────────────────────────────────────────────────
function DeviceList({ devices }) {
  if (!devices || devices.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic', padding: '16px 0' }}>No active connections detected</div>;
  }
  return (
    <div style={{ overflowY: 'auto', maxHeight: '400px' }}>
      {devices.map((d, i) => (
        <div key={i} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px', transition: 'background 0.1s' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, background: TYPE_COLORS[d.type] || '#94a3b8', boxShadow: `0 0 4px ${TYPE_COLORS[d.type] || '#94a3b8'}` }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontFamily: 'var(--mono)' }}>{d.ip}</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              {d.city && d.country ? `${d.city}, ${d.country}` : d.type === 'lan' ? 'LAN' : d.type === 'tailscale' ? 'Tailscale' : d.type === 'zerotier' ? 'ZeroTier' : 'Unknown'}
              {d.services && d.services.length > 0 && ` · ${d.services.join(', ')}`}
            </div>
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>
            <div>{d.connections} conn</div>
            <div style={{ textTransform: 'uppercase', fontSize: '0.58rem', letterSpacing: '0.04em', marginTop: '2px' }}>{d.type}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────────
function SettingsModal({ net, serverLoc, devices, onSave, onClose }) {
  const [lan, setLan] = useState(net.lanIp || '');
  const [zt, setZt]   = useState(net.ztIp || '');
  const [ts, setTs]   = useState(net.tsIp || '');
  const [sLat, setSLat] = useState(serverLoc.lat || '');
  const [sLng, setSLng] = useState(serverLoc.lng || '');
  const [devs, setDevs] = useState(devices || []);
  const [newDev, setNewDev] = useState({ name: '', lat: '', lng: '', type: 'lan' });

  const addDevice = () => {
    if (!newDev.name.trim() || !newDev.lat || !newDev.lng) return;
    setDevs([...devs, { name: newDev.name.trim(), lat: parseFloat(newDev.lat), lng: parseFloat(newDev.lng), type: newDev.type }]);
    setNewDev({ name: '', lat: '', lng: '', type: 'lan' });
  };

  const removeDevice = (i) => setDevs(devs.filter((_, idx) => idx !== i));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxHeight: '85vh', overflowY: 'auto', minWidth: '420px', maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <div style={S.modalTitle}>Settings</div>

        <div style={S.sectionLabel}>Network IPs</div>
        <label style={S.label}>LAN IP</label>
        <input style={S.input} value={lan} onChange={e => setLan(e.target.value)} placeholder="192.168.0.101" />
        <label style={S.label}>ZeroTier IP</label>
        <input style={S.input} value={zt} onChange={e => setZt(e.target.value)} placeholder="e.g. 10.147.20.x" />
        <label style={S.label}>Tailscale IP</label>
        <input style={S.input} value={ts} onChange={e => setTs(e.target.value)} placeholder="e.g. 100.x.x.x" />

        <div style={S.sectionLabel}>Server Location (map pin)</div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}><label style={S.label}>Latitude</label><input style={S.input} value={sLat} onChange={e => setSLat(e.target.value)} placeholder="48.1486" /></div>
          <div style={{ flex: 1 }}><label style={S.label}>Longitude</label><input style={S.input} value={sLng} onChange={e => setSLng(e.target.value)} placeholder="17.1077" /></div>
        </div>

        <div style={S.sectionLabel}>Connected Devices (map pins)</div>
        {devs.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: TYPE_COLORS[d.type] || '#94a3b8', flexShrink: 0 }} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', flex: 1 }}>{d.name}</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{d.lat}, {d.lng}</span>
            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{d.type}</span>
            <button style={{ ...S.btn, padding: '2px 8px', fontSize: '0.7rem' }} onClick={() => removeDevice(i)}>x</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '2 1 100px' }}><label style={{ ...S.label, marginTop: 0 }}>Name</label><input style={S.input} value={newDev.name} onChange={e => setNewDev({ ...newDev, name: e.target.value })} placeholder="My Laptop" /></div>
          <div style={{ flex: '1 1 60px' }}><label style={{ ...S.label, marginTop: 0 }}>Lat</label><input style={S.input} value={newDev.lat} onChange={e => setNewDev({ ...newDev, lat: e.target.value })} placeholder="52.52" /></div>
          <div style={{ flex: '1 1 60px' }}><label style={{ ...S.label, marginTop: 0 }}>Lng</label><input style={S.input} value={newDev.lng} onChange={e => setNewDev({ ...newDev, lng: e.target.value })} placeholder="13.41" /></div>
          <div style={{ flex: '1 1 80px' }}>
            <label style={{ ...S.label, marginTop: 0 }}>Type</label>
            <select style={{ ...S.input, cursor: 'pointer' }} value={newDev.type} onChange={e => setNewDev({ ...newDev, type: e.target.value })}>
              <option value="lan">LAN</option>
              <option value="zerotier">ZeroTier</option>
              <option value="tailscale">Tailscale</option>
            </select>
          </div>
          <button style={{ ...S.btn, ...S.btnPrimary, padding: '9px 14px' }} onClick={addDevice}>+</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <button style={S.btn} onClick={onClose}>Cancel</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => {
            onSave({
              networkConfig: { lanIp: lan, ztIp: zt, tsIp: ts },
              serverLocation: { lat: parseFloat(sLat) || 0, lng: parseFloat(sLng) || 0 },
              devices: devs,
            });
            onClose();
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Service Edit Modal ────────────────────────────────────────────────────
function ServiceEditModal({ svc, overrides, onSave, onClose }) {
  const existing = overrides[svc.name] || {};
  const [name, setName] = useState(existing.name || svc.name);
  const [icon, setIcon] = useState(existing.icon || svc.icon || '');
  const [desc, setDesc] = useState(existing.desc || svc.desc || '');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ minWidth: '380px', maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <div style={S.modalTitle}>Edit Service</div>

        <label style={S.label}>Display Name</label>
        <input style={S.input} value={name} onChange={e => setName(e.target.value)} />

        <label style={S.label}>Icon (emoji)</label>
        <input style={S.input} value={icon} onChange={e => setIcon(e.target.value)} placeholder="e.g. 📺" />

        <label style={S.label}>Description</label>
        <input style={S.input} value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Media server" />

        <div style={{ marginTop: '18px', padding: '14px', background: 'var(--bg-elevated)', borderRadius: '10px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Service Info</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Original name: </span>{svc.name}
          </div>
          {svc.port && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Port: </span><span style={{ fontFamily: 'var(--mono)' }}>{svc.port}</span>
          </div>}
          {svc.url && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px', wordBreak: 'break-all' }}>
            <span style={{ color: 'var(--text-muted)' }}>URL: </span><span style={{ fontFamily: 'var(--mono)' }}>{svc.url}</span>
          </div>}
          {svc.group && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Auto-detected group: </span>{svc.group}
          </div>}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'flex-end' }}>
          <button style={S.btn} onClick={() => {
            const next = { ...overrides };
            delete next[svc.name];
            onSave(next);
            onClose();
          }}>Reset to Default</button>
          <button style={S.btn} onClick={onClose}>Cancel</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => {
            const next = { ...overrides, [svc.name]: { name: name.trim() || svc.name, icon: icon || svc.icon, desc } };
            onSave(next);
            onClose();
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Service Card ──────────────────────────────────────────────────────────
function ServiceCard({ svc, netCfg, overrides, onDragStart, onEdit }) {
  const ovr = overrides[svc.name] || {};
  const displayName = ovr.name || svc.name;
  const displayIcon = ovr.icon || svc.icon || '🔧';
  const displayDesc = ovr.desc != null ? ovr.desc : svc.desc;

  const online = svc.status === 'online';
  const port = svc.port;
  const { lanIp, ztIp, tsIp } = netCfg;

  const lanUrl = port && lanIp ? `http://${lanIp}:${port}` : (lanIp && svc.url ? svc.url.replace('localhost', lanIp) : svc.url);
  const ztUrl  = port && ztIp  ? `http://${ztIp}:${port}` : null;
  const tsUrl  = port && tsIp  ? `http://${tsIp}:${port}` : null;

  const borderLeft = online ? '2px solid var(--success)' : '2px solid var(--danger)';

  return (
    <div
      className="svc-card-wrap"
      style={{ ...S.svcCard, borderLeft }}
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', svc.name); onDragStart && onDragStart(svc.name); }}
    >
      <div style={S.svcTop}>
        <span style={S.svcIcon}>{displayIcon}</span>
        <span style={S.svcName}>{displayName}</span>
        <button style={S.editBtn} onClick={() => onEdit(svc)} title="Edit service">&#9998;</button>
        <span style={S.statusDot(online)} title={online ? 'Online' : 'Offline'} />
      </div>
      {displayDesc && <div style={S.svcDesc}>{displayDesc}</div>}
      {svc.ping_ms != null && <div style={S.ping}>{svc.ping_ms} ms</div>}
      {port && <div style={S.svcPort}>:{port}</div>}
      <div style={S.svcBtns}>
        {lanUrl
          ? <a href={lanUrl} target="_blank" rel="noopener noreferrer" className="access-pill" style={S.lanPill}>LAN</a>
          : <span className="access-pill disabled" style={{ ...S.lanPill, ...S.pillDisabled }} title="Set LAN IP in Settings">LAN</span>}
        {ztUrl
          ? <a href={ztUrl} target="_blank" rel="noopener noreferrer" className="access-pill" style={S.ztPill}>ZeroTier</a>
          : <span className="access-pill disabled" style={{ ...S.ztPill, ...S.pillDisabled }} title="Set ZeroTier IP in Settings">ZeroTier</span>}
        {tsUrl
          ? <a href={tsUrl} target="_blank" rel="noopener noreferrer" className="access-pill" style={S.tsPill}>Tailscale</a>
          : <span className="access-pill disabled" style={{ ...S.tsPill, ...S.pillDisabled }} title="Set Tailscale IP in Settings">Tailscale</span>}
      </div>
    </div>
  );
}

// ── Group Section ─────────────────────────────────────────────────────────
function GroupSection({ name, services, netCfg, overrides, onDrop, onRename, onDelete, onDragStartSvc, onEditSvc }) {
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(name);
  const inputRef = useRef(null);

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const handleRename = () => {
    const trimmed = editVal.trim();
    if (trimmed && trimmed !== name) onRename(name, trimmed);
    setEditing(false);
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={S.groupHeader}>
        {editing ? (
          <input
            ref={inputRef}
            style={S.groupTitleInput}
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditing(false); }}
          />
        ) : (
          <span style={S.groupTitle} onDoubleClick={() => { setEditVal(name); setEditing(true); }}>{name}</span>
        )}
        <span style={S.groupBadge}>{services.length}</span>
        <button style={S.groupDelete} onClick={() => onDelete(name)} title="Delete group"
          onMouseEnter={e => { e.target.style.color = 'var(--danger)'; e.target.style.background = 'var(--danger-dim)'; }}
          onMouseLeave={e => { e.target.style.color = 'var(--text-muted)'; e.target.style.background = 'transparent'; }}
        >&#10005;</button>
      </div>
      <div
        className={`group-dropzone ${over ? 'drag-over' : ''}`}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '10px' }}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const svcName = e.dataTransfer.getData('text/plain'); if (svcName) onDrop(svcName, name); }}
      >
        {services.map(svc => <ServiceCard key={svc.name} svc={svc} netCfg={netCfg} overrides={overrides} onDragStart={onDragStartSvc} onEdit={onEditSvc} />)}
        {services.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', padding: '20px', gridColumn: '1/-1', textAlign: 'center', fontStyle: 'italic' }}>Drag services here</div>}
      </div>
    </div>
  );
}


// ── Main App ──────────────────────────────────────────────────────────────
export default function App() {
  const clock = useClock();
  const [theme, toggleTheme] = useTheme();
  const [system, setSystem]     = useState(null);
  const [services, setServices] = useState([]);
  const [sysErr, setSysErr]     = useState(null);
  const [svcErr, setSvcErr]     = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editingSvc, setEditingSvc] = useState(null);
  const [autoDevices, setAutoDevices] = useState([]);

  // Loading screen state
  const [loading, setLoading] = useState(true);
  const [minTimePassed, setMinTimePassed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinTimePassed(true), 1200);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (system && minTimePassed) setLoading(false);
  }, [system, minTimePassed]);

  // Layout
  const [layout, setLayout] = useState(() => {
    const saved = loadLayout();
    return {
      groups: saved.groups || [],
      assignments: saved.assignments || {},
      networkConfig: saved.networkConfig || { lanIp: '', ztIp: '', tsIp: '' },
      serviceOverrides: saved.serviceOverrides || {},
      serverLocation: saved.serverLocation || { lat: 0, lng: 0 },
      devices: saved.devices || [],
    };
  });

  const persist = useCallback((updater) => {
    setLayout(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveLayout(next);
      return next;
    });
  }, []);

  // Fetch backend config
  useEffect(() => {
    fetch(`${API}/api/config`).then(r => r.json()).then(cfg => {
      setLayout(prev => {
        let changed = false;
        const next = { ...prev };
        const nc = { ...prev.networkConfig };
        if (!nc.lanIp && cfg.lan_ip) { nc.lanIp = cfg.lan_ip; changed = true; }
        if (!nc.ztIp  && cfg.zt_ip)  { nc.ztIp  = cfg.zt_ip;  changed = true; }
        if (!nc.tsIp  && cfg.ts_ip)  { nc.tsIp  = cfg.ts_ip;  changed = true; }
        if (changed) next.networkConfig = nc;
        if ((cfg.server_lat || cfg.server_lng) && (prev.serverLocation.lat !== cfg.server_lat || prev.serverLocation.lng !== cfg.server_lng)) {
          next.serverLocation = { lat: cfg.server_lat || 0, lng: cfg.server_lng || 0 };
          changed = true;
        }
        if (changed) { saveLayout(next); return next; }
        return prev;
      });
    }).catch(() => {});
  }, []);

  // Fetch system + services + devices
  useEffect(() => {
    const fetchSys = () => fetch(`${API}/api/system`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(d => { setSystem(d); setSysErr(null); }).catch(e => setSysErr(e.message));
    const fetchSvc = () => fetch(`${API}/api/services`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(d => { setServices(d); setSvcErr(null); }).catch(e => setSvcErr(e.message));
    const fetchDevices = () => fetch(`${API}/api/devices`).then(r => r.json()).then(d => setAutoDevices(d.devices || [])).catch(() => {});
    fetchSys(); fetchSvc(); fetchDevices();
    const t1 = setInterval(fetchSys, 5000);
    const t2 = setInterval(fetchSvc, 15000);
    const t3 = setInterval(fetchDevices, 10000);
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); };
  }, []);

  // Auto-create groups
  useEffect(() => {
    if (services.length === 0) return;
    setLayout(prev => {
      let groups = [...prev.groups];
      const assignments = { ...prev.assignments };
      let changed = false;
      for (const svc of services) {
        if (!assignments[svc.name]) {
          const g = svc.group || 'Uncategorized';
          assignments[svc.name] = g;
          if (!groups.includes(g)) { groups.push(g); }
          changed = true;
        }
      }
      if (changed) {
        const next = { ...prev, groups, assignments };
        saveLayout(next);
        return next;
      }
      return prev;
    });
  }, [services]);

  // Group management
  const addGroup = () => {
    const name = prompt('New group name:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    persist(prev => prev.groups.includes(trimmed) ? prev : { ...prev, groups: [...prev.groups, trimmed] });
  };

  const renameGroup = (oldName, newName) => {
    persist(prev => {
      if (prev.groups.includes(newName)) return prev;
      const groups = prev.groups.map(g => g === oldName ? newName : g);
      const assignments = {};
      for (const [k, v] of Object.entries(prev.assignments)) assignments[k] = v === oldName ? newName : v;
      return { ...prev, groups, assignments };
    });
  };

  const deleteGroup = (name) => {
    persist(prev => {
      const groups = prev.groups.filter(g => g !== name);
      const assignments = { ...prev.assignments };
      for (const [k, v] of Object.entries(assignments)) {
        if (v === name) assignments[k] = 'Uncategorized';
      }
      if (!groups.includes('Uncategorized') && Object.values(assignments).includes('Uncategorized')) {
        groups.push('Uncategorized');
      }
      return { ...prev, groups, assignments };
    });
  };

  const moveService = (svcName, toGroup) => {
    persist(prev => ({ ...prev, assignments: { ...prev.assignments, [svcName]: toGroup } }));
  };

  const saveSettings = (data) => {
    persist(prev => ({
      ...prev,
      networkConfig: data.networkConfig,
      serverLocation: data.serverLocation,
      devices: data.devices,
    }));
  };

  const saveServiceOverrides = (overrides) => {
    persist(prev => ({ ...prev, serviceOverrides: overrides }));
  };

  // Build grouped services
  const grouped = {};
  for (const g of layout.groups) grouped[g] = [];
  for (const svc of services) {
    const g = layout.assignments[svc.name] || svc.group || 'Uncategorized';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(svc);
  }
  for (const g of layout.groups) { if (!grouped[g]) grouped[g] = []; }

  return (
    <>
      <LoadingScreen visible={loading} />

      <div className="app-enter" style={S.app}>
        {/* ── Header ─────────────────────────────────────────── */}
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={S.logoMark}>H</div>
            <div>
              <div style={S.h1}>Homelab Dashboard</div>
              <div style={S.subtitle}>System metrics · Service status</div>
            </div>
          </div>
          <div style={S.headerRight}>
            <span style={S.clock}>
              {clock.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              {' '}
              {clock.toLocaleTimeString()}
            </span>
            <button className="theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button style={S.btn} onClick={addGroup}
              onMouseEnter={e => Object.assign(e.target.style, S.btnHover)}
              onMouseLeave={e => { e.target.style.background = 'var(--bg-surface)'; e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}
            >+ Group</button>
            <button style={S.btn} onClick={() => setShowSettings(true)}
              onMouseEnter={e => Object.assign(e.target.style, S.btnHover)}
              onMouseLeave={e => { e.target.style.background = 'var(--bg-surface)'; e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}
            >Settings</button>
          </div>
        </div>

        {showSettings && <SettingsModal net={layout.networkConfig} serverLoc={layout.serverLocation} devices={layout.devices} onSave={saveSettings} onClose={() => setShowSettings(false)} />}
        {editingSvc && <ServiceEditModal svc={editingSvc} overrides={layout.serviceOverrides} onSave={saveServiceOverrides} onClose={() => setEditingSvc(null)} />}

        {sysErr && <div style={S.error}>System API: {sysErr}</div>}

        {/* ── System Stats ───────────────────────────────────── */}
        {system && (
          <div style={S.grid}>
            <CpuCard cpu={system.cpu} />
            <RamCard ram={system.ram} />
            <TempCard temp={system.temp_c} />
            <UptimeCard uptime={system.uptime} />
            <NetworkCard net={system.network} />
            {system.disks?.length > 0 && <DisksCard disks={system.disks} />}
            <NetInfoCard netCfg={layout.networkConfig} onOpenSettings={() => setShowSettings(true)} />
          </div>
        )}

        {!system && !sysErr && (
          <div style={S.grid}>
            {['CPU', 'Memory', 'Temperature', 'Uptime', 'Network'].map(t => (
              <div key={t} className="stat-card" style={{ ...S.card, opacity: 0.5 }}>
                <div style={S.cardLabel}>{t}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Loading...</div>
              </div>
            ))}
          </div>
        )}

        {svcErr && <div style={S.error}>Services API: {svcErr}</div>}

        {/* ── Service Groups ─────────────────────────────────── */}
        {Object.entries(grouped).map(([group, svcs]) => (
          <GroupSection
            key={group}
            name={group}
            services={svcs}
            netCfg={layout.networkConfig}
            overrides={layout.serviceOverrides}
            onDrop={moveService}
            onRename={renameGroup}
            onDelete={deleteGroup}
            onEditSvc={svc => setEditingSvc(svc)}
          />
        ))}

        {/* ── Connected Devices & Map ────────────────────────── */}
        {(() => {
          const sLoc = layout.serverLocation;
          const mapDevices = [
            ...autoDevices.map(d => {
              const hasGeo = d.lat && d.lng;
              const nearServer = (sLoc.lat || sLoc.lng) && !hasGeo;
              return {
                name: `${d.ip}${d.city ? ' — ' + d.city : d.type !== 'wan' ? ' — ' + d.type.toUpperCase() : ''}`,
                lat: hasGeo ? d.lat : nearServer ? sLoc.lat + (Math.random() - 0.5) * 0.4 : null,
                lng: hasGeo ? d.lng : nearServer ? sLoc.lng + (Math.random() - 0.5) * 0.4 : null,
                type: d.type,
              };
            }).filter(d => d.lat != null && d.lng != null),
            ...(layout.devices || []),
          ];
          const allDevices = autoDevices;
          const hasMap = sLoc.lat || sLoc.lng || mapDevices.length > 0;

          return (hasMap || allDevices.length > 0) ? (
            <div style={{ marginTop: '36px', marginBottom: '32px' }}>
              <div style={{ ...S.cardLabel, marginBottom: '14px' }}>
                <span style={{ ...S.cardDot, background: 'var(--success)' }} />
                Connected Devices &amp; Map
              </div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                {/* Left — Device List */}
                <div style={{ flex: '1 1 300px', minWidth: '280px', ...S.card }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px' }}>
                    Active Connections ({allDevices.length})
                  </div>
                  <DeviceList devices={allDevices} />
                  {/* Legend */}
                  <div style={{ display: 'flex', gap: '14px', marginTop: '12px', flexWrap: 'wrap', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
                    {[
                      { label: 'Server', color: 'var(--success)' },
                      { label: 'LAN', color: '#60a5fa' },
                      { label: 'Tailscale', color: '#a78bfa' },
                      { label: 'ZT / WAN', color: '#f59e0b' },
                    ].map(l => (
                      <span key={l.label} style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: l.color, flexShrink: 0 }} />{l.label}
                      </span>
                    ))}
                  </div>
                </div>
                {/* Right — Map */}
                {hasMap && (
                  <div style={{ flex: '1.5 1 400px', minHeight: '400px' }}>
                    <WorldMap serverLoc={sLoc} devices={mapDevices} theme={theme} />
                  </div>
                )}
              </div>
            </div>
          ) : null;
        })()}

        {services.length === 0 && !svcErr && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', padding: '32px' }}>
            No services discovered yet. Services running in Docker or k3s will appear automatically.
          </div>
        )}
      </div>
    </>
  );
}
