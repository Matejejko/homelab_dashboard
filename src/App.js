import React, { useState, useEffect, useCallback, useRef } from 'react';

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

// ── Settings Modal ─────────────────────────────────────────────────────────
function SettingsModal({ net, onSave, onClose }) {
  const [lan, setLan] = useState(net.lanIp || '');
  const [zt, setZt]   = useState(net.ztIp || '');
  const [ts, setTs]   = useState(net.tsIp || '');

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.modalTitle}>Network Settings</div>
        <label style={S.label}>LAN IP</label>
        <input style={S.input} value={lan} onChange={e => setLan(e.target.value)} placeholder="192.168.0.101" />
        <label style={S.label}>ZeroTier IP</label>
        <input style={S.input} value={zt} onChange={e => setZt(e.target.value)} placeholder="e.g. 10.147.20.x (leave empty to hide)" />
        <label style={S.label}>Tailscale IP</label>
        <input style={S.input} value={ts} onChange={e => setTs(e.target.value)} placeholder="e.g. 100.x.x.x (leave empty to hide)" />
        <div style={{ display: 'flex', gap: '8px', marginTop: '18px', justifyContent: 'flex-end' }}>
          <button style={S.btn} onClick={onClose}>Cancel</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => { onSave({ lanIp: lan, ztIp: zt, tsIp: ts }); onClose(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Service Card ───────────────────────────────────────────────────────────
function ServiceCard({ svc, netCfg, onDragStart }) {
  const online = svc.status === 'online';
  const port = svc.port;
  const { lanIp, ztIp, tsIp } = netCfg;

  const lanUrl = port && lanIp ? `http://${lanIp}:${port}` : svc.url;
  const ztUrl  = port && ztIp  ? `http://${ztIp}:${port}` : null;
  const tsUrl  = port && tsIp  ? `http://${tsIp}:${port}` : null;

  return (
    <div
      style={{ ...S.svcCard, borderColor: online ? '#1e3a2a' : '#3a1e1e' }}
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', svc.name); onDragStart && onDragStart(svc.name); }}
    >
      <div style={S.svcTop}>
        <span style={S.svcIcon}>{svc.icon || '🔧'}</span>
        <span style={S.svcName}>{svc.name}</span>
        <span style={{ ...S.dot, background: online ? '#22c55e' : '#ef4444' }} />
      </div>
      {svc.desc && <div style={S.svcDesc}>{svc.desc}</div>}
      {svc.ping_ms != null && <div style={S.ping}>{svc.ping_ms} ms</div>}
      <div style={S.svcBtns}>
        {lanUrl && <a href={lanUrl} target="_blank" rel="noopener noreferrer" style={{ ...S.accessBtn, ...S.lanBtn }}>LAN</a>}
        {ztUrl && <a href={ztUrl} target="_blank" rel="noopener noreferrer" style={{ ...S.accessBtn, ...S.ztBtn }}>ZeroTier</a>}
        {tsUrl && <a href={tsUrl} target="_blank" rel="noopener noreferrer" style={{ ...S.accessBtn, ...S.tsBtn }}>Tailscale</a>}
      </div>
    </div>
  );
}

// ── Group Section ──────────────────────────────────────────────────────────
function GroupSection({ name, services, netCfg, onDrop, onRename, onDelete, onDragStartSvc }) {
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
        {services.map(svc => <ServiceCard key={svc.name} svc={svc} netCfg={netCfg} onDragStart={onDragStartSvc} />)}
        {services.length === 0 && <div style={{ color: '#334155', fontSize: '0.8rem', padding: '16px', gridColumn: '1/-1', textAlign: 'center', fontStyle: 'italic' }}>Drag services here</div>}
      </div>
    </div>
  );
}


// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [system, setSystem]     = useState(null);
  const [services, setServices] = useState([]);
  const [sysErr, setSysErr]     = useState(null);
  const [svcErr, setSvcErr]     = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // Layout: { groups: string[], assignments: {svcName: groupName}, networkConfig: {lanIp, ztIp, tsIp} }
  const [layout, setLayout] = useState(() => {
    const saved = loadLayout();
    return {
      groups: saved.groups || [],
      assignments: saved.assignments || {},
      networkConfig: saved.networkConfig || { lanIp: '', ztIp: '', tsIp: '' },
    };
  });

  const persist = useCallback((updater) => {
    setLayout(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveLayout(next);
      return next;
    });
  }, []);

  // Fetch backend config for default IPs on mount
  useEffect(() => {
    fetch(`${API}/api/config`).then(r => r.json()).then(cfg => {
      setLayout(prev => {
        if (!prev.networkConfig.lanIp && cfg.lan_ip) {
          const next = { ...prev, networkConfig: { ...prev.networkConfig, lanIp: cfg.lan_ip, ztIp: prev.networkConfig.ztIp || cfg.zt_ip, tsIp: prev.networkConfig.tsIp || cfg.ts_ip } };
          saveLayout(next);
          return next;
        }
        return prev;
      });
    }).catch(() => {});
  }, []);

  // Fetch system + services
  useEffect(() => {
    const fetchSys = () => fetch(`${API}/api/system`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(d => { setSystem(d); setSysErr(null); }).catch(e => setSysErr(e.message));
    const fetchSvc = () => fetch(`${API}/api/services`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(d => { setServices(d); setSvcErr(null); }).catch(e => setSvcErr(e.message));
    fetchSys(); fetchSvc();
    const t1 = setInterval(fetchSys, 5000);
    const t2 = setInterval(fetchSvc, 15000);
    return () => { clearInterval(t1); clearInterval(t2); };
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

  const saveNetConfig = (cfg) => {
    persist(prev => ({ ...prev, networkConfig: cfg }));
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
          <button style={S.btn} onClick={addGroup}>+ New Group</button>
          <button style={S.btn} onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </div>

      {showSettings && <SettingsModal net={layout.networkConfig} onSave={saveNetConfig} onClose={() => setShowSettings(false)} />}

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
          onDrop={moveService}
          onRename={renameGroup}
          onDelete={deleteGroup}
        />
      ))}

      {services.length === 0 && !svcErr && (
        <div style={{ color: '#475569', fontSize: '0.85rem', textAlign: 'center', padding: '24px' }}>
          No services discovered yet. Services running in Docker or k3s will appear automatically.
        </div>
      )}
    </div>
  );
}
