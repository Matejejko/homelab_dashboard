import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePolling } from '../hooks/usePolling.js';
import { hasLocation, loadLayout, saveLayout } from '../storage.js';
import Header from './Header.jsx';
import NetworkSection from './NetworkSection.jsx';
import ServiceEditModal from './ServiceEditModal.jsx';
import ServiceGrid from './ServiceGrid.jsx';
import SettingsModal from './SettingsModal.jsx';
import StatStrip from './StatStrip.jsx';

const UNGROUPED = 'Uncategorized';
const NO_SERVICES = [];

// Mounted only for a signed-in user past the password change, so nothing here
// polls before the dashboard is on screen, and everything stops on sign-out.
export default function Dashboard({ theme, onToggleTheme, onLogout }) {
  const system = usePolling('/api/system', 5000);
  const servicesPoll = usePolling('/api/services', 15000);
  const network = usePolling('/api/network', 10000);
  const config = usePolling('/api/config', 60000);

  const services = useMemo(() => (
    Array.isArray(servicesPoll.data)
      ? servicesPoll.data.filter((svc) => svc && typeof svc === 'object' && typeof svc.name === 'string')
      : NO_SERVICES
  ), [servicesPoll.data]);
  const [layout, setLayout] = useState(loadLayout);
  const [showSettings, setShowSettings] = useState(false);
  const [editing, setEditing] = useState(null);

  const persist = useCallback((updater) => {
    setLayout((prev) => {
      const next = updater(prev);
      if (next !== prev) saveLayout(next);
      return next;
    });
  }, []);

  // New services land in the group their source suggested.
  useEffect(() => {
    if (services.length === 0) return;
    persist((prev) => {
      const groups = [...prev.groups];
      const assignments = { ...prev.assignments };
      let changed = false;
      for (const svc of services) {
        if (assignments[svc.name]) continue;
        const group = svc.group || UNGROUPED;
        assignments[svc.name] = group;
        if (!groups.includes(group)) groups.push(group);
        changed = true;
      }
      return changed ? { ...prev, groups, assignments } : prev;
    });
  }, [services, persist]);

  // Server addresses always come from /api/config, never from saved layouts.
  const cfg = config.data;
  const addresses = useMemo(() => ({
    lan: (cfg && cfg.lan_ip) || '',
    tailscale: (cfg && cfg.ts_ip) || '',
    zerotier: (cfg && cfg.zt_ip) || '',
  }), [cfg]);

  // CARTO API key for the map tiles. null until /api/config has answered, so
  // the map does not fetch keyless tiles first and then fetch them all again.
  let tileKey = null;
  if (cfg) tileKey = typeof cfg.tile_key === 'string' ? cfg.tile_key : '';
  else if (config.error) tileKey = '';

  // A location set in Settings wins over the one from /api/config.
  const defaultLocation = useMemo(
    () => ({ lat: (cfg && cfg.server_lat) || 0, lng: (cfg && cfg.server_lng) || 0 }),
    [cfg],
  );
  const server = useMemo(() => {
    if (hasLocation(layout.serverLocation)) return layout.serverLocation;
    return hasLocation(defaultLocation) ? defaultLocation : null;
  }, [layout.serverLocation, defaultLocation]);

  const grouped = useMemo(() => {
    const out = {};
    for (const group of layout.groups) out[group] = [];
    for (const svc of services) {
      const group = layout.assignments[svc.name] || svc.group || UNGROUPED;
      (out[group] = out[group] || []).push(svc);
    }
    return out;
  }, [services, layout.groups, layout.assignments]);
  const groupNames = useMemo(() => Object.keys(grouped), [grouped]);

  const addGroup = (name) => persist((prev) => (
    prev.groups.includes(name) ? prev : { ...prev, groups: [...prev.groups, name] }
  ));

  const renameGroup = (from, to) => persist((prev) => {
    if (prev.groups.includes(to)) return prev;
    const assignments = {};
    for (const [service, group] of Object.entries(prev.assignments)) {
      assignments[service] = group === from ? to : group;
    }
    return { ...prev, groups: prev.groups.map((g) => (g === from ? to : g)), assignments };
  });

  const deleteGroup = (name) => persist((prev) => {
    const groups = prev.groups.filter((g) => g !== name);
    const assignments = { ...prev.assignments };
    for (const [service, group] of Object.entries(assignments)) {
      if (group === name) assignments[service] = UNGROUPED;
    }
    if (!groups.includes(UNGROUPED) && Object.values(assignments).includes(UNGROUPED)) groups.push(UNGROUPED);
    return { ...prev, groups, assignments };
  });

  const moveService = (service, group) => persist((prev) => (
    prev.assignments[service] === group
      ? prev
      : { ...prev, assignments: { ...prev.assignments, [service]: group } }
  ));

  const saveOverride = (service, override, group) => persist((prev) => ({
    ...prev,
    serviceOverrides: { ...prev.serviceOverrides, [service]: override },
    assignments: group ? { ...prev.assignments, [service]: group } : prev.assignments,
  }));

  const resetOverride = (service) => persist((prev) => {
    const serviceOverrides = { ...prev.serviceOverrides };
    delete serviceOverrides[service];
    return { ...prev, serviceOverrides };
  });

  const saveSettings = ({ serverLocation, devices }) => persist((prev) => ({ ...prev, serverLocation, devices }));

  return (
    <div className="shell">
      <Header
        theme={theme}
        onToggleTheme={onToggleTheme}
        onOpenSettings={() => setShowSettings(true)}
        onLogout={onLogout}
      />

      <main>
        {system.error && <p className="notice notice--bad" role="alert">System API: {system.error}</p>}
        <StatStrip system={system.data} error={system.error} />

        <NetworkSection
          network={network.data}
          error={network.error}
          server={server}
          addresses={addresses}
          pins={layout.devices}
          theme={theme}
          tileKey={tileKey}
        />

        <ServiceGrid
          services={services}
          error={servicesPoll.error}
          loaded={servicesPoll.data !== null}
          groups={groupNames}
          grouped={grouped}
          addresses={addresses}
          overrides={layout.serviceOverrides}
          onAddGroup={addGroup}
          onRenameGroup={renameGroup}
          onDeleteGroup={deleteGroup}
          onMoveService={moveService}
          onEdit={setEditing}
        />
      </main>

      <footer className="footer">
        Built by{' '}
        <a href="https://github.com/Matejejko" target="_blank" rel="noopener noreferrer">Matejejko</a>
      </footer>

      {showSettings && (
        <SettingsModal
          serverLocation={layout.serverLocation}
          defaultLocation={defaultLocation}
          pins={layout.devices}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
      {editing && (
        <ServiceEditModal
          svc={editing}
          override={layout.serviceOverrides[editing.name]}
          groups={groupNames}
          group={layout.assignments[editing.name] || editing.group || UNGROUPED}
          onSave={saveOverride}
          onReset={resetOverride}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
