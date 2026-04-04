import { useState, useEffect, useCallback } from "react";

// ╔══════════════════════════════════════════════════════════════╗
// ║  SET THIS TO YOUR SERVER'S IP ADDRESS                       ║
// ║  Example: "http://192.168.1.100:8000"                       ║
// ╚══════════════════════════════════════════════════════════════╝
const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

const POLL_SYSTEM_MS   = 3000;   // how often to refresh system stats
const POLL_SERVICES_MS = 15000;  // how often to re-check service health

// ─── Group color palette ──────────────────────────────────────────────────────
const GROUP_COLORS = {
  Media:   { bg:"rgba(168,85,247,0.12)",  border:"rgba(168,85,247,0.35)",  dot:"#a855f7", badge:"rgba(168,85,247,0.2)",  text:"#c084fc" },
  Network: { bg:"rgba(20,184,166,0.12)",  border:"rgba(20,184,166,0.35)",  dot:"#14b8a6", badge:"rgba(20,184,166,0.2)",  text:"#2dd4bf" },
  Dev:     { bg:"rgba(59,130,246,0.12)",  border:"rgba(59,130,246,0.35)",  dot:"#3b82f6", badge:"rgba(59,130,246,0.2)",  text:"#60a5fa" },
  Home:    { bg:"rgba(251,146,60,0.12)",  border:"rgba(251,146,60,0.35)",  dot:"#fb923c", badge:"rgba(251,146,60,0.2)",  text:"#fb923c" },
  Default: { bg:"rgba(34,211,238,0.12)",  border:"rgba(34,211,238,0.35)",  dot:"#22d3ee", badge:"rgba(34,211,238,0.2)",  text:"#22d3ee" },
};
const gc = (group) => GROUP_COLORS[group] || GROUP_COLORS.Default;

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function fetchSystem() {
  const r = await fetch(`${API_BASE}/api/system`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fetchServices() {
  const r = await fetch(`${API_BASE}/api/services`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ─── Hooks ────────────────────────────────────────────────────────────────────
function useClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return t;
}

function usePolled(fetchFn, interval) {
  const [data,  setData]  = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    try {
      const d = await fetchFn();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fetchFn]);

  useEffect(() => {
    run();
    const id = setInterval(run, interval);
    return () => clearInterval(id);
  }, [run, interval]);

  return { data, error, loading };
}

// ─── Tiny UI primitives ───────────────────────────────────────────────────────
function Bar({ pct, color = "#22d3ee" }) {
  return (
    <div style={{ height:6, background:"rgba(255,255,255,0.07)", borderRadius:3, overflow:"hidden" }}>
      <div style={{
        height:"100%", width:`${Math.min(pct,100)}%`, background:color, borderRadius:3,
        transition:"width 0.7s ease", boxShadow:`0 0 8px ${color}66`
      }}/>
    </div>
  );
}

function StatusDot({ online }) {
  return (
    <span style={{ position:"relative", display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
      <span style={{ width:8, height:8, borderRadius:"50%", background:online ? "#22c55e" : "#ef4444", display:"inline-block", position:"relative", zIndex:1 }}/>
      {online && <span style={{ position:"absolute", width:16, height:16, borderRadius:"50%", background:"#22c55e33", animation:"pulse 2s ease-in-out infinite" }}/>}
    </span>
  );
}

function Skeleton({ w = "100%", h = 20, r = 6 }) {
  return <div style={{ width:w, height:h, borderRadius:r, background:"rgba(255,255,255,0.06)", animation:"shimmer 1.5s infinite linear", backgroundImage:"linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.04) 50%,transparent 100%)", backgroundSize:"200px 100%" }}/>;
}

function MiniSparkline({ points = [] }) {
  const w = 120, h = 36;
  if (points.length < 2) return <div style={{ width:w, height:h }}/>;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const pts = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display:"block", overflow:"visible" }}>
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35"/>
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#sg)"/>
      <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

function RadialGauge({ value, color="#22d3ee", size=80, label }) {
  const r=32, cx=40, cy=40, circ=2*Math.PI*r;
  const dash = Math.min(value/100, 1) * circ;
  return (
    <svg width={size+20} height={size+20} viewBox="0 0 80 80">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="7"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transform:"rotate(-90deg)", transformOrigin:"50% 50%", transition:"stroke-dasharray 0.6s ease" }}/>
      <text x={cx} y={cy-4} textAnchor="middle" fill="white" fontSize="13" fontWeight="700" fontFamily="'JetBrains Mono',monospace">{Math.round(value)}</text>
      <text x={cx} y={cy+10} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="8" fontFamily="'JetBrains Mono',monospace">{label}</text>
    </svg>
  );
}

// ─── Service card ─────────────────────────────────────────────────────────────
function ServiceCard({ svc, dark }) {
  const g = gc(svc.group);
  const [hov, setHov] = useState(false);
  const online = svc.status === "online";
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? g.bg : dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
        border:`1px solid ${hov ? g.border : dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)"}`,
        borderRadius:12, padding:"14px 16px", display:"flex", flexDirection:"column", gap:10,
        transition:"all 0.2s ease", transform: hov ? "translateY(-2px)" : "none",
        boxShadow: hov ? `0 8px 24px ${g.border}` : "none",
      }}
    >
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:20, lineHeight:1 }}>{svc.icon || "⚙️"}</span>
          <div>
            <div style={{ fontWeight:700, fontSize:13, color: dark?"#f1f5f9":"#1e293b", fontFamily:"'JetBrains Mono',monospace" }}>{svc.name}</div>
            <div style={{ fontSize:11, color: dark?"#64748b":"#94a3b8", marginTop:1 }}>{svc.desc || ""}</div>
          </div>
        </div>
        <StatusDot online={online}/>
      </div>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:20, background:g.badge, color:g.text, fontWeight:600, letterSpacing:"0.04em" }}>
          {svc.group || "Other"}
        </span>
        <span style={{ fontSize:10, fontFamily:"'JetBrains Mono',monospace", color: svc.ping_ms !== null && svc.ping_ms !== undefined
          ? (svc.ping_ms < 20 ? "#22c55e" : svc.ping_ms < 80 ? "#facc15" : "#f97316")
          : (online ? "#64748b" : "#ef4444")
        }}>
          {svc.ping_ms !== null && svc.ping_ms !== undefined ? `${svc.ping_ms}ms` : online ? "—" : "OFFLINE"}
        </span>
      </div>

      <a
        href={svc.url} target="_blank" rel="noopener noreferrer"
        style={{
          display:"flex", alignItems:"center", justifyContent:"center",
          padding:"6px 0", borderRadius:8, fontSize:12, fontWeight:600,
          background: online ? g.badge : "rgba(255,255,255,0.04)",
          color: online ? g.text : dark ? "#475569" : "#94a3b8",
          textDecoration:"none", border:`1px solid ${online ? g.border : "transparent"}`,
          transition:"all 0.15s",
          pointerEvents: !online ? "none" : "auto",
        }}
        onClick={e => !online && e.preventDefault()}
      >
        {online ? "Open →" : "Offline"}
      </a>
    </div>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────────────
function ErrorBanner({ message }) {
  return (
    <div style={{
      background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)",
      borderRadius:10, padding:"10px 16px", fontSize:12, color:"#f87171",
      display:"flex", alignItems:"center", gap:10, fontFamily:"'JetBrains Mono',monospace"
    }}>
      <span>⚠</span>
      <span>Cannot reach backend at <b>{API_BASE}</b> — {message}</span>
      <span style={{ marginLeft:"auto", color:"rgba(248,113,113,0.5)", fontSize:11 }}>retrying…</span>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function HomelabDashboard() {
  const [dark, setDark] = useState(true);
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState("All");
  const [cpuHistory, setCpuHistory] = useState([]);

  const time = useClock();
  const { data: sys,  error: sysErr,  loading: sysLoading  } = usePolled(fetchSystem,   POLL_SYSTEM_MS);
  const { data: svcs, error: svcsErr, loading: svcsLoading } = usePolled(fetchServices, POLL_SERVICES_MS);

  // Build CPU sparkline history
  useEffect(() => {
    if (sys) setCpuHistory(h => [...h.slice(-29), sys.cpu.percent]);
  }, [sys]);

  const bg          = dark ? "#0a0f1a" : "#f1f5f9";
  const cardBg      = dark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.9)";
  const cardBorder  = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)";
  const textPrimary = dark ? "#f1f5f9" : "#1e293b";
  const textMuted   = dark ? "#64748b" : "#94a3b8";
  const accent      = "#22d3ee";

  // Derive group list from actual service data
  const groups = ["All", ...Array.from(new Set((svcs || []).map(s => s.group).filter(Boolean)))];
  const filtered = (svcs || []).filter(s =>
    (activeGroup === "All" || s.group === activeGroup) &&
    (s.name.toLowerCase().includes(search.toLowerCase()) || (s.desc || "").toLowerCase().includes(search.toLowerCase()))
  );
  const onlineCount = (svcs || []).filter(s => s.status === "online").length;

  const fmt = n => n.toString().padStart(2, "0");
  const timeStr = `${fmt(time.getHours())}:${fmt(time.getMinutes())}:${fmt(time.getSeconds())}`;
  const dateStr = time.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric", year:"numeric" });

  const cpuColor = (pct) => pct > 80 ? "#f97316" : pct > 60 ? "#facc15" : accent;
  const tempColor = (t) => t > 70 ? "#f97316" : t > 60 ? "#facc15" : "#22c55e";

  return (
    <div style={{ minHeight:"100vh", background:bg, color:textPrimary, fontFamily:"'Inter','Segoe UI',sans-serif", transition:"background 0.3s,color 0.3s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes pulse{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(2.2);opacity:0}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes shimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}
        .grid-services{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
        @media(max-width:640px){.grid-services{grid-template-columns:1fr 1fr}}
        @media(max-width:400px){.grid-services{grid-template-columns:1fr}}
        .topbar-inner{max-width:1280px;margin:0 auto;padding:0 24px;height:60px;display:flex;align-items:center;justify-content:space-between}
        .main-inner{max-width:1280px;margin:0 auto;padding:24px}
        @media(max-width:768px){.main-inner{padding:16px}}
        input::placeholder{color:rgba(100,116,139,0.5)}
        input{outline:none}
        ::-webkit-scrollbar{width:6px}
        ::-webkit-scrollbar-thumb{background:rgba(100,116,139,0.3);border-radius:3px}
      `}</style>

      {/* ── Top Bar ── */}
      <div style={{ background:dark?"rgba(10,15,26,0.85)":"rgba(255,255,255,0.85)", backdropFilter:"blur(20px)", borderBottom:`1px solid ${cardBorder}`, position:"sticky", top:0, zIndex:100 }}>
        <div className="topbar-inner">
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:32, height:32, borderRadius:8, background:"linear-gradient(135deg,#22d3ee,#3b82f6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>🖥️</div>
            <div>
              <div style={{ fontWeight:700, fontSize:15, letterSpacing:"-0.02em", color:textPrimary }}>Homelab</div>
              <div style={{ fontSize:11, color:textMuted, fontFamily:"'JetBrains Mono',monospace" }}>{API_BASE}</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            {/* Live indicator */}
            <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color: sysErr ? "#ef4444" : "#22c55e", fontFamily:"'JetBrains Mono',monospace" }}>
              <StatusDot online={!sysErr}/>
              {sysErr ? "API unreachable" : "Live"}
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:16, color:accent, letterSpacing:"0.04em" }}>{timeStr}</div>
              <div style={{ fontSize:11, color:textMuted }}>{dateStr}</div>
            </div>
            <button onClick={() => setDark(d => !d)} style={{ width:36, height:36, borderRadius:8, border:`1px solid ${cardBorder}`, background:cardBg, color:textPrimary, cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}>
              {dark ? "☀️" : "🌙"}
            </button>
          </div>
        </div>
      </div>

      <div className="main-inner" style={{ display:"flex", flexDirection:"column", gap:24 }}>

        {/* ── Error banners ── */}
        {sysErr  && <ErrorBanner message={sysErr}/>}
        {svcsErr && <ErrorBanner message={svcsErr}/>}

        {/* ── System Overview ── */}
        <section style={{ animation:"fadeIn 0.4s ease" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
            <div style={{ width:3, height:18, background:accent, borderRadius:2 }}/>
            <span style={{ fontWeight:700, fontSize:13, letterSpacing:"0.08em", textTransform:"uppercase", color:textMuted }}>System Overview</span>
            <div style={{ flex:1, height:1, background:cardBorder, marginLeft:8 }}/>
            {sys && (
              <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"#22c55e", fontFamily:"'JetBrains Mono',monospace" }}>
                <StatusDot online={true}/>
                {sys.uptime.days}d {sys.uptime.hours}h {sys.uptime.minutes}m uptime
              </div>
            )}
          </div>

          {/* Stat cards row */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:12, marginBottom:12 }}>

            {/* CPU */}
            <div style={{ background:cardBg, border:`1px solid ${cardBorder}`, borderRadius:14, padding:"16px 20px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:11, color:textMuted, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" }}>CPU</div>
                  {sysLoading ? <Skeleton w={80} h={32} r={6}/> : (
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:28, fontWeight:700, color:textPrimary, lineHeight:1.1, marginTop:4 }}>
                      {sys?.cpu.percent}<span style={{ fontSize:14, color:textMuted }}>%</span>
                    </div>
                  )}
                </div>
                <MiniSparkline points={cpuHistory}/>
              </div>
              {sysLoading ? <Skeleton h={6}/> : <Bar pct={sys?.cpu.percent || 0} color={cpuColor(sys?.cpu.percent || 0)}/>}
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:8 }}>
                <span style={{ fontSize:11, color:textMuted }}>{sys ? `${sys.cpu.cores}c / ${sys.cpu.threads}t` : "—"}</span>
                <span style={{ fontSize:11, fontFamily:"monospace", color:textMuted }}>{sys?.cpu.load_avg?.join(" · ") || "—"}</span>
              </div>
            </div>

            {/* RAM */}
            <div style={{ background:cardBg, border:`1px solid ${cardBorder}`, borderRadius:14, padding:"16px 20px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:11, color:textMuted, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" }}>Memory</div>
                  {sysLoading ? <Skeleton w={80} h={32} r={6}/> : (
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:28, fontWeight:700, color:textPrimary, lineHeight:1.1, marginTop:4 }}>
                      {sys?.ram.percent}<span style={{ fontSize:14, color:textMuted }}>%</span>
                    </div>
                  )}
                </div>
                <RadialGauge value={sys?.ram.percent || 0} color="#a855f7" size={60} label="RAM"/>
              </div>
              <Bar pct={sys?.ram.percent || 0} color="#a855f7"/>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:8 }}>
                <span style={{ fontSize:11, color:textMuted }}>Used</span>
                <span style={{ fontSize:11, fontFamily:"monospace", color:textMuted }}>
                  {sys ? `${sys.ram.used_gb} GB / ${sys.ram.total_gb} GB` : "—"}
                </span>
              </div>
            </div>

            {/* Temperature */}
            <div style={{ background:cardBg, border:`1px solid ${cardBorder}`, borderRadius:14, padding:"16px 20px" }}>
              <div style={{ fontSize:11, color:textMuted, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:12 }}>Temperature</div>
              {sysLoading ? <Skeleton w={100} h={36} r={6}/> : sys?.temp_c !== null && sys?.temp_c !== undefined ? (
                <>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:28, fontWeight:700, color:tempColor(sys.temp_c) }}>
                      {sys.temp_c}°<span style={{ fontSize:14 }}>C</span>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:11, color:textMuted }}>Status</div>
                      <div style={{ fontSize:12, fontWeight:600, color: sys.temp_c < 60 ? "#22c55e" : "#facc15" }}>
                        {sys.temp_c < 60 ? "Normal" : sys.temp_c < 75 ? "Warm" : "Hot"}
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop:12 }}>
                    <Bar pct={(sys.temp_c / 90) * 100} color={tempColor(sys.temp_c)}/>
                    <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:10, color:textMuted, fontFamily:"monospace" }}>
                      <span>0°</span><span>45°</span><span>90°</span>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ color:textMuted, fontSize:13, marginTop:8 }}>
                  Not available on this system.<br/>
                  <span style={{ fontSize:11 }}>Check lm-sensors is installed.</span>
                </div>
              )}
            </div>

            {/* Network */}
            <div style={{ background:cardBg, border:`1px solid ${cardBorder}`, borderRadius:14, padding:"16px 20px" }}>
              <div style={{ fontSize:11, color:textMuted, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:16 }}>Network I/O</div>
              {sysLoading ? <Skeleton h={48} r={8}/> : (
                <div style={{ display:"flex", gap:24 }}>
                  <div>
                    <div style={{ fontSize:10, color:"#22c55e", fontWeight:600, marginBottom:4 }}>▼ DOWN</div>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:700, color:"#22c55e" }}>{sys?.network.rx_mb_s}</div>
                    <div style={{ fontSize:10, color:textMuted }}>MB/s</div>
                  </div>
                  <div style={{ width:1, background:cardBorder }}/>
                  <div>
                    <div style={{ fontSize:10, color:"#3b82f6", fontWeight:600, marginBottom:4 }}>▲ UP</div>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:700, color:"#3b82f6" }}>{sys?.network.tx_mb_s}</div>
                    <div style={{ fontSize:10, color:textMuted }}>MB/s</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Disks */}
          {sysLoading ? (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
              {[0,1,2].map(i => <Skeleton key={i} h={90} r={14}/>)}
            </div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
              {(sys?.disks || []).map((d, i) => {
                const color = d.pct > 85 ? "#f97316" : d.pct > 70 ? "#facc15" : accent;
                return (
                  <div key={i} style={{ background:cardBg, border:`1px solid ${cardBorder}`, borderRadius:14, padding:"14px 18px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:14 }}>💾</span>
                        <div>
                          <div style={{ fontWeight:700, fontSize:13, color:textPrimary }}>{d.mount}</div>
                          <div style={{ fontSize:10, fontFamily:"monospace", color:textMuted }}>{d.device} · {d.fstype}</div>
                        </div>
                      </div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:700, color }}>{d.pct}%</div>
                    </div>
                    <Bar pct={d.pct} color={color}/>
                    <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:11, color:textMuted, fontFamily:"monospace" }}>
                      <span>{d.used_gb >= 1000 ? `${(d.used_gb/1000).toFixed(1)}TB` : `${d.used_gb}GB`} used</span>
                      <span>{d.total_gb >= 1000 ? `${(d.total_gb/1000).toFixed(0)}TB` : `${d.total_gb}GB`} total</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Services ── */}
        <section style={{ animation:"fadeIn 0.5s 0.1s ease both" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16, flexWrap:"wrap" }}>
            <div style={{ width:3, height:18, background:"#a855f7", borderRadius:2 }}/>
            <span style={{ fontWeight:700, fontSize:13, letterSpacing:"0.08em", textTransform:"uppercase", color:textMuted }}>Services</span>
            {svcs && (
              <span style={{ fontSize:11, fontFamily:"'JetBrains Mono',monospace", background:"rgba(34,197,94,0.15)", color:"#22c55e", padding:"2px 8px", borderRadius:20, fontWeight:600 }}>
                {onlineCount}/{svcs.length} online
              </span>
            )}
            <div style={{ flex:1, height:1, background:cardBorder, marginLeft:4 }}/>
          </div>

          {/* Search + filter */}
          <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
            <div style={{ flex:"1 1 200px", display:"flex", alignItems:"center", gap:8, background:cardBg, border:`1px solid ${cardBorder}`, borderRadius:10, padding:"8px 14px" }}>
              <span style={{ color:textMuted, fontSize:14 }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search services…"
                style={{ flex:1, background:"transparent", border:"none", color:textPrimary, fontSize:13 }}/>
              {search && <span onClick={() => setSearch("")} style={{ cursor:"pointer", color:textMuted }}>✕</span>}
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {groups.map(g => {
                const c = GROUP_COLORS[g];
                const active = activeGroup === g;
                return (
                  <button key={g} onClick={() => setActiveGroup(g)} style={{
                    padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
                    background: active ? (c ? c.badge : "rgba(34,211,238,0.15)") : cardBg,
                    color: active ? (c ? c.text : accent) : textMuted,
                    border:`1px solid ${active ? (c ? c.border : "rgba(34,211,238,0.4)") : cardBorder}`,
                    transition:"all 0.15s"
                  }}>{g}</button>
                );
              })}
            </div>
          </div>

          {/* Grid */}
          {svcsLoading ? (
            <div className="grid-services">
              {[...Array(6)].map((_,i) => <Skeleton key={i} h={140} r={12}/>)}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 20px", color:textMuted, fontSize:14 }}>
              <div style={{ fontSize:32, marginBottom:10 }}>🔎</div>
              No services match "{search}"
            </div>
          ) : (
            <div className="grid-services">
              {filtered.map((svc, i) => <ServiceCard key={svc.name + i} svc={svc} dark={dark}/>)}
            </div>
          )}
        </section>

        {/* Footer */}
        <div style={{ textAlign:"center", padding:"16px 0 8px", color:textMuted, fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>
          homelab dashboard · system poll every {POLL_SYSTEM_MS/1000}s · service check every {POLL_SERVICES_MS/1000}s
        </div>
      </div>
    </div>
  );
}
