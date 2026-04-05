import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Live Clock ────────────────────────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

const API = process.env.REACT_APP_API_URL || '';
const LS_KEY = 'homelab-dashboard-layout';

// ── persistence ────────────────────────────────────────────────────────────
function loadLayout() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function saveLayout(l) { localStorage.setItem(LS_KEY, JSON.stringify(l)); }

// ── helpers ────────────────────────────────────────────────────────────────
function barColor(pct) {
  if (pct > 85) return '#ef4444';
  if (pct > 65) return '#f59e0b';
  return '#22c55e';
}

// ── styles ─────────────────────────────────────────────────────────────────
const S = {
  app: { minHeight: '100vh', background: '#0f1117', color: '#e2e8f0', fontFamily: "'Segoe UI', system-ui, sans-serif", padding: '24px' },
  header: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' },
  h1: { fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc', margin: 0 },
  subtitle: { fontSize: '0.85rem', color: '#64748b' },
  headerRight: { marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' },
  btn: { background: '#1e2130', border: '1px solid #2d3148', borderRadius: '8px', padding: '6px 14px', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px' },
  btnPrimary: { background: '#1d4ed8', border: '1px solid #2563eb', color: '#fff' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px', marginBottom: '28px' },
  card: { background: '#1e2130', borderRadius: '12px', padding: '18px', border: '1px solid #2d3148' },
  cardTitle: { fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' },
  bigNum: { fontSize: '1.8rem', fontWeight: 700, color: '#f8fafc' },
  bigUnit: { fontSize: '0.9rem', color: '#94a3b8', marginLeft: '4px' },
  sub: { fontSize: '0.78rem', color: '#64748b', marginTop: '4px' },
  bar: { height: '5px', borderRadius: '3px', background: '#2d3148', marginTop: '8px', overflow: 'hidden' },
  // group
  groupHeader: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', marginTop: '16px' },
  groupTitle: { fontSize: '0.95rem', fontWeight: 600, color: '#94a3b8', cursor: 'pointer' },
  groupTitleInput: { fontSize: '0.95rem', fontWeight: 600, color: '#f8fafc', background: '#2d3148', border: '1px solid #475569', borderRadius: '4px', padding: '2px 8px', outline: 'none' },
  groupDelete: { marginLeft: 'auto', cursor: 'pointer', color: '#475569', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', border: '1px solid transparent' },
  groupZone: { minHeight: '60px', borderRadius: '10px', padding: '4px', transition: 'background 0.15s' },
  groupZoneOver: { background: 'rgba(59,130,246,0.08)', border: '1px dashed #3b82f6' },
  // service card
  svcCard: { background: '#1e2130', border: '1px solid #2d3148', borderRadius: '10px', padding: '12px', cursor: 'grab', transition: 'border-color 0.15s, opacity 0.15s', userSelect: 'none' },
  svcTop: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  svcIcon: { fontSize: '1.2rem' },
  svcName: { fontWeight: 600, fontSize: '0.88rem', color: '#f1f5f9' },
  svcDesc: { fontSize: '0.72rem', color: '#64748b', marginBottom: '6px' },
  dot: { width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block', marginLeft: 'auto', flexShrink: 0 },
  ping: { fontSize: '0.68rem', color: '#475569' },
  svcBtns: { display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap' },
  accessBtn: { fontSize: '0.65rem', padding: '3px 8px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontWeight: 600, textDecoration: 'none', display: 'inline-block' },
  lanBtn: { background: '#1e3a5f', color: '#60a5fa' },
  ztBtn: { background: '#3d2e0a', color: '#f59e0b' },
  tsBtn: { background: '#2e1065', color: '#a78bfa' },
  btnDisabled: { background: '#1a1c28', color: '#334155', cursor: 'default', opacity: 0.5 },
  clock: { fontSize: '0.9rem', color: '#64748b', fontVariantNumeric: 'tabular-nums' },
  netInfoRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  netInfoLabel: { fontSize: '0.72rem', fontWeight: 600, minWidth: '70px' },
  netInfoVal: { fontSize: '0.82rem', color: '#f1f5f9', fontFamily: 'monospace' },
  netInfoNone: { fontSize: '0.82rem', color: '#334155', fontStyle: 'italic' },
  editBtn: { background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '0.72rem', padding: '2px 4px', borderRadius: '4px', marginLeft: '4px' },
  svcInfoRow: { fontSize: '0.7rem', color: '#475569', marginTop: '2px', fontFamily: 'monospace', wordBreak: 'break-all' },
  // modal
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#1e2130', border: '1px solid #2d3148', borderRadius: '14px', padding: '24px', minWidth: '340px', maxWidth: '90vw' },
  modalTitle: { fontSize: '1rem', fontWeight: 700, color: '#f8fafc', marginBottom: '16px' },
  label: { display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px', marginTop: '12px' },
  input: { width: '100%', padding: '8px 10px', background: '#0f1117', border: '1px solid #2d3148', borderRadius: '6px', color: '#f8fafc', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' },
  error: { background: '#2d1a1a', border: '1px solid #7f1d1d', borderRadius: '8px', padding: '10px 14px', color: '#fca5a5', fontSize: '0.82rem', marginBottom: '14px' },
  diskRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  diskLabel: { fontSize: '0.78rem', color: '#94a3b8', minWidth: '50px' },
  diskPct: { fontSize: '0.78rem', color: '#64748b', marginLeft: 'auto', minWidth: '36px', textAlign: 'right' },
};

// ── Bar ────────────────────────────────────────────────────────────────────
function Bar({ pct }) {
  return (
    <div style={S.bar}>
      <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: barColor(pct), borderRadius: '3px', transition: 'width 0.4s' }} />
    </div>
  );
}

// ── System Stat Cards ──────────────────────────────────────────────────────
function StatCard({ title, children }) {
  return <div style={S.card}><div style={S.cardTitle}>{title}</div>{children}</div>;
}

function CpuCard({ cpu }) {
  return (
    <StatCard title="CPU">
      <span style={S.bigNum}>{cpu.percent.toFixed(1)}</span><span style={S.bigUnit}>%</span>
      <Bar pct={cpu.percent} />
      <div style={S.sub}>{cpu.cores}c / {cpu.threads}t{cpu.freq_mhz ? ` · ${(cpu.freq_mhz / 1000).toFixed(2)} GHz` : ''}</div>
      <div style={S.sub}>Load: {cpu.load_avg.join(' · ')}</div>
    </StatCard>
  );
}

function RamCard({ ram }) {
  return (
    <StatCard title="Memory">
      <span style={S.bigNum}>{ram.used_gb.toFixed(1)}</span><span style={S.bigUnit}>/ {ram.total_gb.toFixed(1)} GB</span>
      <Bar pct={ram.percent} />
      <div style={S.sub}>{ram.percent.toFixed(1)}% used · {ram.free_gb.toFixed(1)} GB free</div>
    </StatCard>
  );
}

function TempCard({ temp }) {
  return (
    <StatCard title="Temperature">
      {temp != null
        ? <><span style={S.bigNum}>{temp}</span><span style={S.bigUnit}>°C</span><Bar pct={temp} /></>
        : <div style={{ color: '#475569', fontSize: '0.85rem', marginTop: '6px' }}>Not available</div>}
    </StatCard>
  );
}

function UptimeCard({ uptime }) {
  return (
    <StatCard title="Uptime">
      <span style={S.bigNum}>{uptime.days}</span><span style={S.bigUnit}>d </span>
      <span style={S.bigNum}>{uptime.hours}</span><span style={S.bigUnit}>h </span>
      <span style={S.bigNum}>{uptime.minutes}</span><span style={S.bigUnit}>m</span>
    </StatCard>
  );
}

function NetworkCard({ net }) {
  return (
    <StatCard title="Network">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
        <div><div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#f8fafc' }}>↓ {net.rx_mb_s}</div><div style={{ fontSize: '0.72rem', color: '#64748b' }}>MB/s recv</div></div>
        <div style={{ textAlign: 'right' }}><div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#f8fafc' }}>{net.tx_mb_s} ↑</div><div style={{ fontSize: '0.72rem', color: '#64748b' }}>MB/s sent</div></div>
      </div>
    </StatCard>
  );
}

function DisksCard({ disks }) {
  return (
    <StatCard title={`Disks (${disks.length})`}>
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

// ── Network Info Card ──────────────────────────────────────────────────────
function NetInfoCard({ netCfg, onOpenSettings }) {
  const entries = [
    { label: 'LAN', ip: netCfg.lanIp, color: '#60a5fa' },
    { label: 'ZeroTier', ip: netCfg.ztIp, color: '#f59e0b' },
    { label: 'Tailscale', ip: netCfg.tsIp, color: '#a78bfa' },
  ];
  return (
    <StatCard title="Network IPs">
      {entries.map(e => (
        <div key={e.label} style={S.netInfoRow}>
          <span style={{ ...S.netInfoLabel, color: e.color }}>{e.label}</span>
          {e.ip ? <span style={S.netInfoVal}>{e.ip}</span> : <span style={S.netInfoNone}>not set</span>}
        </div>
      ))}
      <div style={{ marginTop: '8px' }}>
        <button style={{ ...S.btn, fontSize: '0.7rem', padding: '3px 10px' }} onClick={onOpenSettings}>Edit IPs</button>
      </div>
    </StatCard>
  );
}

// ── World Map ──────────────────────────────────────────────────────────────
const TYPE_COLORS = { lan: '#60a5fa', zerotier: '#f59e0b', tailscale: '#a78bfa', wan: '#f59e0b' };

function WorldMap({ serverLoc, devices }) {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const layerRef = useRef(null);

  // Init map once
  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current || mapInst.current) return;
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: true })
      .setView([serverLoc.lat || 30, serverLoc.lng || 0], serverLoc.lat ? 4 : 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: 'CartoDB',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);
    mapInst.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapInst.current = null; };
  }, []); // init once

  // Update markers when data changes
  useEffect(() => {
    const L = window.L;
    if (!L || !mapInst.current || !layerRef.current) return;
    layerRef.current.clearLayers();

    const sLat = serverLoc.lat, sLng = serverLoc.lng;
    if (sLat || sLng) {
      const serverIcon = L.divIcon({ className: '', html: '<div style="width:14px;height:14px;background:#22c55e;border:2px solid #fff;border-radius:50%;box-shadow:0 0 8px #22c55e"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
      L.marker([sLat, sLng], { icon: serverIcon }).addTo(layerRef.current).bindPopup('<b>Server</b>');
    }

    (devices || []).forEach(d => {
      if (!d.lat && !d.lng) return;
      const color = TYPE_COLORS[d.type] || '#94a3b8';
      const devIcon = L.divIcon({ className: '', html: `<div style="width:10px;height:10px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px ${color}"></div>`, iconSize: [10, 10], iconAnchor: [5, 5] });
      L.marker([d.lat, d.lng], { icon: devIcon }).addTo(layerRef.current).bindPopup(`<b>${d.name}</b><br/>${d.type}`);
      if (sLat || sLng) {
        L.polyline([[sLat, sLng], [d.lat, d.lng]], { color, weight: 1.5, opacity: 0.4, dashArray: '6 4' }).addTo(layerRef.current);
      }
    });
  }, [serverLoc, devices]);

  return <div ref={mapRef} style={{ height: '100%', minHeight: '400px', borderRadius: '12px', border: '1px solid #2d3148' }} />;
}

// ── Device List ───────────────────────────────────────────────────────────
function DeviceList({ devices }) {
  if (!devices || devices.length === 0) {
    return <div style={{ color: '#475569', fontSize: '0.82rem', fontStyle: 'italic', padding: '12px 0' }}>No active connections detected</div>;
  }
  return (
    <div style={{ overflowY: 'auto', maxHeight: '400px' }}>
      {devices.map((d, i) => (
        <div key={i} style={{ padding: '8px 10px', borderBottom: '1px solid #1a1c28', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, background: TYPE_COLORS[d.type] || '#94a3b8' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.82rem', color: '#f1f5f9', fontFamily: 'monospace' }}>{d.ip}</div>
            <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
              {d.city && d.country ? `${d.city}, ${d.country}` : d.type === 'lan' ? 'LAN' : d.type === 'tailscale' ? 'Tailscale' : d.type === 'zerotier' ? 'ZeroTier' : 'Unknown'}
              {d.services && d.services.length > 0 && ` · ${d.services.join(', ')}`}
            </div>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#475569', textAlign: 'right', flexShrink: 0 }}>
            <div>{d.connections} conn</div>
            <div style={{ textTransform: 'uppercase', fontSize: '0.6rem' }}>{d.type}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Settings Modal ─────────────────────────────────────────────────────────
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
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxHeight: '85vh', overflowY: 'auto', minWidth: '400px' }} onClick={e => e.stopPropagation()}>
        <div style={S.modalTitle}>Settings</div>

        {/* Network IPs */}
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', marginTop: '8px', marginBottom: '4px' }}>Network IPs</div>
        <label style={S.label}>LAN IP</label>
        <input style={S.input} value={lan} onChange={e => setLan(e.target.value)} placeholder="192.168.0.101" />
        <label style={S.label}>ZeroTier IP</label>
        <input style={S.input} value={zt} onChange={e => setZt(e.target.value)} placeholder="e.g. 10.147.20.x" />
        <label style={S.label}>Tailscale IP</label>
        <input style={S.input} value={ts} onChange={e => setTs(e.target.value)} placeholder="e.g. 100.x.x.x" />

        {/* Server Location */}
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', marginTop: '18px', marginBottom: '4px' }}>Server Location (map pin)</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}><label style={S.label}>Latitude</label><input style={S.input} value={sLat} onChange={e => setSLat(e.target.value)} placeholder="48.1486" /></div>
          <div style={{ flex: 1 }}><label style={S.label}>Longitude</label><input style={S.input} value={sLng} onChange={e => setSLng(e.target.value)} placeholder="17.1077" /></div>
        </div>

        {/* Connected Devices */}
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8', marginTop: '18px', marginBottom: '4px' }}>Connected Devices (map pins)</div>
        {devs.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', borderBottom: '1px solid #1a1c28' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: TYPE_COLORS[d.type] || '#94a3b8', flexShrink: 0 }} />
            <span style={{ fontSize: '0.8rem', color: '#e2e8f0', flex: 1 }}>{d.name}</span>
            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{d.lat}, {d.lng}</span>
            <span style={{ fontSize: '0.65rem', color: '#475569', textTransform: 'uppercase' }}>{d.type}</span>
            <button style={{ ...S.btn, padding: '1px 6px', fontSize: '0.7rem' }} onClick={() => removeDevice(i)}>x</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
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
          <button style={{ ...S.btn, ...S.btnPrimary, padding: '8px 12px', marginBottom: '0' }} onClick={addDevice}>+</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'flex-end' }}>
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

// ── Service Edit Modal ─────────────────────────────────────────────────────
function ServiceEditModal({ svc, overrides, onSave, onClose }) {
  const existing = overrides[svc.name] || {};
  const [name, setName] = useState(existing.name || svc.name);
  const [icon, setIcon] = useState(existing.icon || svc.icon || '');
  const [desc, setDesc] = useState(existing.desc || svc.desc || '');

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.modalTitle}>Edit Service</div>

        <label style={S.label}>Display Name</label>
        <input style={S.input} value={name} onChange={e => setName(e.target.value)} />

        <label style={S.label}>Icon (emoji)</label>
        <input style={S.input} value={icon} onChange={e => setIcon(e.target.value)} placeholder="e.g. 📺" />

        <label style={S.label}>Description</label>
        <input style={S.input} value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Media server" />

        {/* Read-only info */}
        <div style={{ marginTop: '16px', padding: '10px', background: '#0f1117', borderRadius: '8px', border: '1px solid #1e2130' }}>
          <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase' }}>Service Info</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '3px' }}>
            <span style={{ color: '#64748b' }}>Original name: </span>{svc.name}
          </div>
          {svc.port && <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '3px' }}>
            <span style={{ color: '#64748b' }}>Port: </span>{svc.port}
          </div>}
          {svc.url && <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '3px', wordBreak: 'break-all' }}>
            <span style={{ color: '#64748b' }}>URL: </span>{svc.url}
          </div>}
          {svc.group && <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '3px' }}>
            <span style={{ color: '#64748b' }}>Auto-detected group: </span>{svc.group}
          </div>}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '18px', justifyContent: 'flex-end' }}>
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

// ── Service Card ───────────────────────────────────────────────────────────
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

  return (
    <div
      style={{ ...S.svcCard, borderColor: online ? '#1e3a2a' : '#3a1e1e' }}
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', svc.name); onDragStart && onDragStart(svc.name); }}
    >
      <div style={S.svcTop}>
        <span style={S.svcIcon}>{displayIcon}</span>
        <span style={S.svcName}>{displayName}</span>
        <button style={S.editBtn} onClick={() => onEdit(svc)} title="Edit service">&#9998;</button>
        <span style={{ ...S.dot, background: online ? '#22c55e' : '#ef4444' }} />
      </div>
      {displayDesc && <div style={S.svcDesc}>{displayDesc}</div>}
      {svc.ping_ms != null && <div style={S.ping}>{svc.ping_ms} ms</div>}
      {port && <div style={S.svcInfoRow}>:{port}</div>}
      <div style={S.svcBtns}>
        {lanUrl
          ? <a href={lanUrl} target="_blank" rel="noopener noreferrer" style={{ ...S.accessBtn, ...S.lanBtn }}>LAN</a>
          : <span style={{ ...S.accessBtn, ...S.lanBtn, ...S.btnDisabled }} title="Set LAN IP in Settings">LAN</span>}
        {ztUrl
          ? <a href={ztUrl} target="_blank" rel="noopener noreferrer" style={{ ...S.accessBtn, ...S.ztBtn }}>ZeroTier</a>
          : <span style={{ ...S.accessBtn, ...S.ztBtn, ...S.btnDisabled }} title="Set ZeroTier IP in Settings">ZeroTier</span>}
        {tsUrl
          ? <a href={tsUrl} target="_blank" rel="noopener noreferrer" style={{ ...S.accessBtn, ...S.tsBtn }}>Tailscale</a>
          : <span style={{ ...S.accessBtn, ...S.tsBtn, ...S.btnDisabled }} title="Set Tailscale IP in Settings">Tailscale</span>}
      </div>
    </div>
  );
}

// ── Group Section ──────────────────────────────────────────────────────────
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
    <div style={{ marginBottom: '20px' }}>
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
        <span style={{ fontSize: '0.7rem', color: '#475569' }}>({services.length})</span>
        <button style={S.groupDelete} onClick={() => onDelete(name)} title="Delete group">✕</button>
      </div>
      <div
        style={{ ...S.groupZone, ...(over ? S.groupZoneOver : {}), display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const svcName = e.dataTransfer.getData('text/plain'); if (svcName) onDrop(svcName, name); }}
      >
        {services.map(svc => <ServiceCard key={svc.name} svc={svc} netCfg={netCfg} overrides={overrides} onDragStart={onDragStartSvc} onEdit={onEditSvc} />)}
        {services.length === 0 && <div style={{ color: '#334155', fontSize: '0.8rem', padding: '16px', gridColumn: '1/-1', textAlign: 'center', fontStyle: 'italic' }}>Drag services here</div>}
      </div>
    </div>
  );
}


// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const clock = useClock();
  const [system, setSystem]     = useState(null);
  const [services, setServices] = useState([]);
  const [sysErr, setSysErr]     = useState(null);
  const [svcErr, setSvcErr]     = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editingSvc, setEditingSvc] = useState(null); // service being edited
  const [autoDevices, setAutoDevices] = useState([]); // auto-detected from /api/devices

  // Layout: { groups, assignments, networkConfig, serviceOverrides, serverLocation, devices }
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

  // Fetch backend config for default IPs + server location on mount
  useEffect(() => {
    fetch(`${API}/api/config`).then(r => r.json()).then(cfg => {
      setLayout(prev => {
        let changed = false;
        const next = { ...prev };
        if (!prev.networkConfig.lanIp && cfg.lan_ip) {
          next.networkConfig = { ...prev.networkConfig, lanIp: cfg.lan_ip, ztIp: prev.networkConfig.ztIp || cfg.zt_ip, tsIp: prev.networkConfig.tsIp || cfg.ts_ip };
          changed = true;
        }
        if ((cfg.server_lat || cfg.server_lng) && (prev.serverLocation.lat !== cfg.server_lat || prev.serverLocation.lng !== cfg.server_lng)) {
          next.serverLocation = { lat: cfg.server_lat || 0, lng: cfg.server_lng || 0 };
          changed = true;
        }
        if (changed) { saveLayout(next); return next; }
        return prev;
      });
    }).catch(() => {});
  }, []);

  // Fetch system + services
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

  // Auto-create groups from services if layout is empty
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
      // Move services to Uncategorized
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
  // Ensure all groups from layout are present (even empty)
  for (const g of layout.groups) { if (!grouped[g]) grouped[g] = []; }

  return (
    <div style={S.app}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={S.h1}>Homelab Dashboard</div>
          <div style={S.subtitle}>System metrics · Service status</div>
        </div>
        <div style={S.headerRight}>
          <span style={S.clock}>{clock.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })} {clock.toLocaleTimeString()}</span>
          <button style={S.btn} onClick={addGroup}>+ New Group</button>
          <button style={S.btn} onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </div>

      {showSettings && <SettingsModal net={layout.networkConfig} serverLoc={layout.serverLocation} devices={layout.devices} onSave={saveSettings} onClose={() => setShowSettings(false)} />}
      {editingSvc && <ServiceEditModal svc={editingSvc} overrides={layout.serviceOverrides} onSave={saveServiceOverrides} onClose={() => setEditingSvc(null)} />}

      {sysErr && <div style={S.error}>System API: {sysErr}</div>}

      {/* System Stats */}
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
            <div key={t} style={{ ...S.card, opacity: 0.4 }}><div style={S.cardTitle}>{t}</div><div style={{ color: '#475569' }}>Loading...</div></div>
          ))}
        </div>
      )}

      {svcErr && <div style={S.error}>Services API: {svcErr}</div>}

      {/* Service Groups */}
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

      {/* Connected Devices & Map */}
      {(() => {
        const sLoc = layout.serverLocation;
        // Merge auto-detected devices (from API) with manual devices (from settings)
        const mapDevices = [
          ...autoDevices.map(d => {
            // WAN devices use their geolocated position; LAN/Tailscale/ZeroTier cluster near server
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
          <div style={{ marginTop: '28px', marginBottom: '28px' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>Connected Devices &amp; Map</div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {/* Left — Device List */}
              <div style={{ flex: '1 1 300px', minWidth: '280px', background: '#1e2130', borderRadius: '12px', border: '1px solid #2d3148', padding: '14px' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', marginBottom: '10px' }}>
                  Active Connections ({allDevices.length})
                </div>
                <DeviceList devices={allDevices} />
                {/* Legend */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.68rem', color: '#475569' }}><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', marginRight: '3px' }} />Server</span>
                  <span style={{ fontSize: '0.68rem', color: '#475569' }}><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#60a5fa', marginRight: '3px' }} />LAN</span>
                  <span style={{ fontSize: '0.68rem', color: '#475569' }}><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#a78bfa', marginRight: '3px' }} />Tailscale</span>
                  <span style={{ fontSize: '0.68rem', color: '#475569' }}><span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#f59e0b', marginRight: '3px' }} />ZeroTier / WAN</span>
                </div>
              </div>
              {/* Right — Map */}
              {hasMap && (
                <div style={{ flex: '1.5 1 400px', minHeight: '400px' }}>
                  <WorldMap serverLoc={sLoc} devices={mapDevices} />
                </div>
              )}
            </div>
          </div>
        ) : null;
      })()}

      {services.length === 0 && !svcErr && (
        <div style={{ color: '#475569', fontSize: '0.85rem', textAlign: 'center', padding: '24px' }}>
          No services discovered yet. Services running in Docker or k3s will appear automatically.
        </div>
      )}
    </div>
  );
}
