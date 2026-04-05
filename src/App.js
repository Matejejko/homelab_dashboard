import React, { useState, useEffect } from 'react';

const API = process.env.REACT_APP_API_URL || '';

// ── styles ────────────────────────────────────────────────────────────────────
const S = {
  app: {
    minHeight: '100vh',
    background: '#0f1117',
    color: '#e2e8f0',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    padding: '24px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '32px',
  },
  h1: { fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' },
  subtitle: { fontSize: '0.85rem', color: '#64748b', marginTop: '2px' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px',
    marginBottom: '32px',
  },
  card: {
    background: '#1e2130',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #2d3148',
  },
  cardTitle: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '12px',
  },
  bigNumber: { fontSize: '2rem', fontWeight: 700, color: '#f8fafc' },
  bigUnit: { fontSize: '1rem', color: '#94a3b8', marginLeft: '4px' },
  sub: { fontSize: '0.8rem', color: '#64748b', marginTop: '4px' },
  bar: {
    height: '6px',
    borderRadius: '3px',
    background: '#2d3148',
    marginTop: '10px',
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#94a3b8',
    marginBottom: '12px',
    marginTop: '8px',
  },
  serviceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '12px',
  },
  serviceCard: {
    background: '#1e2130',
    border: '1px solid #2d3148',
    borderRadius: '10px',
    padding: '14px',
    textDecoration: 'none',
    color: 'inherit',
    display: 'block',
    transition: 'border-color 0.15s',
  },
  serviceTop: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  icon: { fontSize: '1.3rem' },
  serviceName: { fontWeight: 600, fontSize: '0.9rem', color: '#f1f5f9' },
  serviceDesc: { fontSize: '0.75rem', color: '#64748b' },
  dot: {
    width: '8px', height: '8px', borderRadius: '50%',
    display: 'inline-block', marginLeft: 'auto', flexShrink: 0,
  },
  ping: { fontSize: '0.7rem', color: '#475569', marginTop: '4px' },
  diskRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
  diskLabel: { fontSize: '0.8rem', color: '#94a3b8', minWidth: '60px' },
  diskPct: { fontSize: '0.8rem', color: '#64748b', marginLeft: 'auto' },
  netRow: { display: 'flex', justifyContent: 'space-between', marginTop: '6px' },
  netVal: { fontSize: '1.1rem', fontWeight: 600, color: '#f8fafc' },
  netLabel: { fontSize: '0.75rem', color: '#64748b' },
  tag: {
    display: 'inline-block',
    fontSize: '0.65rem',
    background: '#1a2035',
    border: '1px solid #2d3148',
    borderRadius: '4px',
    padding: '1px 6px',
    color: '#64748b',
    marginBottom: '6px',
  },
  error: {
    background: '#2d1a1a',
    border: '1px solid #7f1d1d',
    borderRadius: '8px',
    padding: '12px 16px',
    color: '#fca5a5',
    fontSize: '0.85rem',
    marginBottom: '16px',
  },
};

// ── helpers ───────────────────────────────────────────────────────────────────
function barColor(pct) {
  if (pct > 85) return '#ef4444';
  if (pct > 65) return '#f59e0b';
  return '#22c55e';
}

function Bar({ pct }) {
  return (
    <div style={S.bar}>
      <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: barColor(pct), borderRadius: '3px', transition: 'width 0.4s' }} />
    </div>
  );
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const g = item[key] || 'Other';
    (acc[g] = acc[g] || []).push(item);
    return acc;
  }, {});
}

// ── components ────────────────────────────────────────────────────────────────
function StatCard({ title, children }) {
  return (
    <div style={S.card}>
      <div style={S.cardTitle}>{title}</div>
      {children}
    </div>
  );
}

function CpuCard({ cpu }) {
  return (
    <StatCard title="CPU">
      <span style={S.bigNumber}>{cpu.percent.toFixed(1)}</span>
      <span style={S.bigUnit}>%</span>
      <Bar pct={cpu.percent} />
      <div style={S.sub}>
        {cpu.cores}c / {cpu.threads}t
        {cpu.freq_mhz ? ` · ${(cpu.freq_mhz / 1000).toFixed(2)} GHz` : ''}
      </div>
      <div style={S.sub}>Load: {cpu.load_avg.join(' · ')}</div>
    </StatCard>
  );
}

function RamCard({ ram }) {
  return (
    <StatCard title="Memory">
      <span style={S.bigNumber}>{ram.used_gb.toFixed(1)}</span>
      <span style={S.bigUnit}>/ {ram.total_gb.toFixed(1)} GB</span>
      <Bar pct={ram.percent} />
      <div style={S.sub}>{ram.percent.toFixed(1)}% used · {ram.free_gb.toFixed(1)} GB free</div>
    </StatCard>
  );
}

function TempCard({ temp }) {
  if (temp === null || temp === undefined) {
    return (
      <StatCard title="Temperature">
        <div style={{ color: '#475569', fontSize: '0.9rem', marginTop: '8px' }}>Not available</div>
        <div style={S.sub}>Install lm-sensors on host</div>
      </StatCard>
    );
  }
  return (
    <StatCard title="Temperature">
      <span style={S.bigNumber}>{temp}</span>
      <span style={S.bigUnit}>°C</span>
      <Bar pct={(temp / 100) * 100} />
    </StatCard>
  );
}

function UptimeCard({ uptime }) {
  return (
    <StatCard title="Uptime">
      <span style={S.bigNumber}>{uptime.days}</span>
      <span style={S.bigUnit}>d </span>
      <span style={S.bigNumber}>{uptime.hours}</span>
      <span style={S.bigUnit}>h </span>
      <span style={S.bigNumber}>{uptime.minutes}</span>
      <span style={S.bigUnit}>m</span>
    </StatCard>
  );
}

function NetworkCard({ net }) {
  return (
    <StatCard title="Network">
      <div style={S.netRow}>
        <div>
          <div style={S.netVal}>↓ {net.rx_mb_s}</div>
          <div style={S.netLabel}>MB/s recv</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={S.netVal}>{net.tx_mb_s} ↑</div>
          <div style={S.netLabel}>MB/s sent</div>
        </div>
      </div>
    </StatCard>
  );
}

function DisksCard({ disks }) {
  return (
    <StatCard title={`Disks (${disks.length})`}>
      {disks.slice(0, 4).map((d, i) => (
        <div key={i} style={S.diskRow}>
          <div style={S.diskLabel}>{d.mount}</div>
          <div style={{ flex: 1 }}>
            <Bar pct={d.pct} />
          </div>
          <div style={S.diskPct}>{d.pct.toFixed(0)}%</div>
        </div>
      ))}
      {disks.length === 0 && <div style={S.sub}>No disks found</div>}
    </StatCard>
  );
}

function ServiceCard({ svc }) {
  const online = svc.status === 'online';
  const dotColor = online ? '#22c55e' : '#ef4444';
  const cardStyle = {
    ...S.serviceCard,
    borderColor: online ? '#1e3a2a' : '#3a1e1e',
  };
  return (
    <a href={svc.url || '#'} target="_blank" rel="noopener noreferrer" style={cardStyle}>
      <div style={S.serviceTop}>
        <span style={S.icon}>{svc.icon || '🔧'}</span>
        <span style={S.serviceName}>{svc.name}</span>
        <span style={{ ...S.dot, background: dotColor }} title={svc.status} />
      </div>
      {svc.desc && <div style={S.serviceDesc}>{svc.desc}</div>}
      {svc.ping_ms !== null && svc.ping_ms !== undefined && (
        <div style={S.ping}>{svc.ping_ms} ms</div>
      )}
    </a>
  );
}

// ── main app ──────────────────────────────────────────────────────────────────
export default function App() {
  const [system, setSystem] = useState(null);
  const [services, setServices] = useState(null);
  const [sysErr, setSysErr] = useState(null);
  const [svcErr, setSvcErr] = useState(null);

  async function fetchSystem() {
    try {
      const r = await fetch(`${API}/api/system`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSystem(await r.json());
      setSysErr(null);
    } catch (e) {
      setSysErr(e.message);
    }
  }

  async function fetchServices() {
    try {
      const r = await fetch(`${API}/api/services`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setServices(await r.json());
      setSvcErr(null);
    } catch (e) {
      setSvcErr(e.message);
    }
  }

  useEffect(() => {
    fetchSystem();
    fetchServices();
    const sysTimer = setInterval(fetchSystem, 5000);
    const svcTimer = setInterval(fetchServices, 15000);
    return () => { clearInterval(sysTimer); clearInterval(svcTimer); };
  }, []);

  const groups = services ? groupBy(services, 'group') : {};

  return (
    <div style={S.app}>
      <div style={S.header}>
        <span style={{ fontSize: '1.8rem' }}>🖥️</span>
        <div>
          <div style={S.h1}>Homelab Dashboard</div>
          <div style={S.subtitle}>System metrics · Service status</div>
        </div>
      </div>

      {sysErr && <div style={S.error}>System API error: {sysErr}</div>}

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
        <div style={{ ...S.grid }}>
          {['CPU', 'Memory', 'Temperature', 'Uptime', 'Network'].map(t => (
            <div key={t} style={{ ...S.card, opacity: 0.4 }}>
              <div style={S.cardTitle}>{t}</div>
              <div style={{ color: '#475569' }}>Loading…</div>
            </div>
          ))}
        </div>
      )}

      {svcErr && <div style={S.error}>Services API error: {svcErr}</div>}

      {Object.keys(groups).sort().map(group => (
        <div key={group}>
          <div style={S.sectionTitle}>{group}</div>
          <div style={{ ...S.serviceGrid, marginBottom: '20px' }}>
            {groups[group].map((svc, i) => <ServiceCard key={i} svc={svc} />)}
          </div>
        </div>
      ))}

      {services && services.length === 0 && (
        <div style={{ color: '#475569', fontSize: '0.9rem' }}>
          No services discovered. Add Ingresses to the cluster or edit the ConfigMap.
        </div>
      )}
    </div>
  );
}
