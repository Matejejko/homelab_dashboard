import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import L from 'leaflet';
import { DIRECTIONS, NET_LABELS } from '../format.js';
import { el, renderPeerPopup, renderPinPopup, renderServerPopup } from '../mapPopups.js';
import { lineWeight } from '../peers.js';
import Icon from './Icon.jsx';

const TILE_URL = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
};
const ATTRIBUTION = '© OpenStreetMap contributors © CARTO';

// A 24 px hit target centred on the exact coordinate, with the pin in its middle.
function makeMarker(pin, zIndexOffset) {
  return L.marker([0, 0], {
    icon: L.divIcon({ className: 'pin-anchor', html: pin, iconSize: [24, 24] }),
    keyboard: true,
    riseOnHover: true,
    zIndexOffset,
  });
}

function setLabel(marker, entry, label) {
  if (entry.label === label) return;
  entry.label = label;
  const icon = marker.getElement();
  if (icon) {
    icon.setAttribute('aria-label', label);
    icon.setAttribute('title', label);
  }
}

function setClass(node, entry, field, value) {
  if (entry[field] === value) return;
  entry[field] = value;
  node.setAttribute('class', value);
}

const pinKey = (pin, n) => `pin:${pin.type}:${pin.lat}:${pin.lng}:${pin.name}:${n}`;

/**
 * Props:
 *   server     {lat, lng} | null
 *   addresses  {lan, tailscale, zerotier}   shown in the server popup
 *   peers      located peers: one marker and one line each, keyed by IP
 *   sitePeers  peers at the server site: one badge on the server marker
 *   pins       manual pins from Settings
 *   accounting whether byte counters are available (drives line weight)
 * Ref: focusPeer(ip), focusServer()
 */
export default function NetworkMap({ ref, server, addresses, peers, sitePeers, pins, accounting, theme }) {
  const canvasRef = useRef(null);
  const mapRef = useRef(null);
  const tilesRef = useRef(null);
  const linesRef = useRef(null);
  const entriesRef = useRef(new Map());
  const serverRef = useRef(null);
  const pointsRef = useRef([]);
  const fitSigRef = useRef('');
  const autoFitRef = useRef(true);
  const programmaticRef = useRef(false);
  const themeRef = useRef(theme);

  const [autoFit, setAutoFit] = useState(true);
  const [tilesDown, setTilesDown] = useState(false);

  const fitTo = (points) => {
    const map = mapRef.current;
    if (!map || !points.length) return;
    programmaticRef.current = true;
    try {
      if (points.length === 1) map.setView(points[0], 5, { animate: false });
      else map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 9, animate: false });
    } finally {
      programmaticRef.current = false;
    }
  };

  const stopAutoFit = () => {
    if (programmaticRef.current || !autoFitRef.current) return;
    autoFitRef.current = false;
    setAutoFit(false);
  };

  // ── Create the map once ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const map = L.map(canvas, { worldCopyJump: true, minZoom: 1, zoomSnap: 0.5 }).setView([25, 10], 2);
    const tiles = L.tileLayer(TILE_URL[themeRef.current] || TILE_URL.dark, {
      attribution: ATTRIBUTION,
      subdomains: 'abcd',
      maxZoom: 19,
    });
    // Markers and lines never depend on the tiles: if they fail, say so and carry on.
    tiles.on('tileerror', () => setTilesDown(true));
    tiles.on('tileload', () => setTilesDown(false));
    tiles.addTo(map);

    mapRef.current = map;
    tilesRef.current = tiles;
    linesRef.current = L.layerGroup().addTo(map);

    // Auto-fit lasts until the user takes over the view.
    map.on('dragstart', stopAutoFit);
    map.on('zoomstart', stopAutoFit);
    const onKey = (event) => {
      if (event.key.startsWith('Arrow')) stopAutoFit();
    };
    canvas.addEventListener('keydown', onKey);

    const resize = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      if (autoFitRef.current) fitTo(pointsRef.current);
    });
    resize.observe(canvas);

    return () => {
      resize.disconnect();
      canvas.removeEventListener('keydown', onKey);
      map.remove();
      mapRef.current = null;
      tilesRef.current = null;
      linesRef.current = null;
      serverRef.current = null;
      entriesRef.current = new Map();
      pointsRef.current = [];
      fitSigRef.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Theme: swap the tile style, keep everything else ─────────────────────
  useEffect(() => {
    themeRef.current = theme;
    if (tilesRef.current) tilesRef.current.setUrl(TILE_URL[theme] || TILE_URL.dark);
  }, [theme]);

  // ── Sync layers by diff: add, update in place, remove. Never rebuild. ────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const entries = entriesRef.current;

    // Server marker, with every local-network peer folded into one badge.
    let site = serverRef.current;
    if (server) {
      if (!site) {
        const pin = el('div', 'pin pin--server');
        const badge = el('span', 'pin__badge');
        pin.append(el('span', 'pin__shape'), badge);
        const popupNode = el('div', 'popup');
        const marker = makeMarker(pin, 1000).bindPopup(popupNode, { maxWidth: 300 }).addTo(map);
        site = serverRef.current = { marker, badge, popupNode, lat: null, lng: null };
      }
      if (site.lat !== server.lat || site.lng !== server.lng) {
        site.lat = server.lat;
        site.lng = server.lng;
        site.marker.setLatLng([server.lat, server.lng]);
      }
      const badgeText = sitePeers.length ? `Local network · ${sitePeers.length}` : '';
      if (site.badgeText !== badgeText) {
        site.badgeText = badgeText;
        site.badge.textContent = badgeText;
        site.badge.hidden = !badgeText;
      }
      setLabel(site.marker, site, badgeText ? `Server, ${badgeText}` : 'Server');
      if (renderServerPopup(site.popupNode, addresses, sitePeers, accounting) && site.marker.isPopupOpen()) {
        site.marker.getPopup().update();
      }
    } else if (site) {
      site.marker.remove();
      serverRef.current = null;
    }

    const wanted = new Map();
    for (const peer of peers) wanted.set(`peer:${peer.ip}`, { peer });
    pins.forEach((pin, index) => wanted.set(pinKey(pin, index), { pin }));

    for (const [key, entry] of entries) {
      if (wanted.has(key)) continue;
      entry.marker.remove();
      if (entry.line) entry.line.remove();
      entries.delete(key);
    }

    for (const [key, { peer, pin }] of wanted) {
      const lat = peer ? peer.geo.lat : pin.lat;
      const lng = peer ? peer.geo.lng : pin.lng;
      const pinClass = peer ? `pin pin--${peer.net}` : `pin pin--${pin.type} pin--manual`;

      let entry = entries.get(key);
      if (!entry) {
        const pinNode = el('div');
        pinNode.append(el('span', 'pin__shape'));
        const popupNode = el('div', 'popup');
        const marker = makeMarker(pinNode, 0).bindPopup(popupNode, { maxWidth: 300 });
        entry = { marker, pinNode, popupNode, line: null, lat: null, lng: null };
        entries.set(key, entry);
        marker.setLatLng([lat, lng]).addTo(map);
        entry.lat = lat;
        entry.lng = lng;
      } else if (entry.lat !== lat || entry.lng !== lng) {
        entry.lat = lat;
        entry.lng = lng;
        entry.marker.setLatLng([lat, lng]);
      }
      setClass(entry.pinNode, entry, 'pinClass', pinClass);

      const changed = peer
        ? renderPeerPopup(entry.popupNode, peer, accounting)
        : renderPinPopup(entry.popupNode, pin);
      if (changed && entry.marker.isPopupOpen()) entry.marker.getPopup().update();

      setLabel(
        entry.marker, entry,
        peer
          ? `${peer.name || peer.ip}, ${NET_LABELS[peer.net] || peer.net}, ${DIRECTIONS[peer.direction]?.short || ''}`
          : `${pin.name}, manual pin`,
      );

      // One line per located peer, from the peer to the server.
      if (peer && server) {
        const lineClass = `flow flow--${peer.net} flow--${peer.direction}`;
        const weight = lineWeight(peer, accounting);
        const path = `${lat},${lng}>${server.lat},${server.lng}`;
        if (!entry.line) {
          entry.line = L.polyline([[lat, lng], [server.lat, server.lng]], {
            className: lineClass, weight, interactive: false,
          }).addTo(linesRef.current);
          entry.lineClass = lineClass;
          entry.weight = weight;
          entry.path = path;
        } else {
          if (entry.path !== path) {
            entry.path = path;
            entry.line.setLatLngs([[lat, lng], [server.lat, server.lng]]);
          }
          if (entry.weight !== weight) {
            entry.weight = weight;
            entry.line.setStyle({ weight });
          }
          const svgPath = entry.line.getElement();
          if (svgPath) setClass(svgPath, entry, 'lineClass', lineClass);
        }
      } else if (entry.line) {
        entry.line.remove();
        entry.line = null;
      }
    }

    // Fit to server plus peers whenever that set of points changes, until the
    // user pans or zooms.
    const points = [];
    if (server) points.push([server.lat, server.lng]);
    for (const peer of peers) points.push([peer.geo.lat, peer.geo.lng]);
    for (const pin of pins) points.push([pin.lat, pin.lng]);
    pointsRef.current = points;
    const fitSig = points.map((p) => p.join(',')).sort().join('|');
    if (autoFitRef.current && fitSig !== fitSigRef.current) {
      fitSigRef.current = fitSig;
      fitTo(points);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, addresses, peers, sitePeers, pins, accounting]);

  const focus = (entry) => {
    const map = mapRef.current;
    if (!map || !entry) return;
    // The user chose where to look: stop moving the view for them.
    autoFitRef.current = false;
    setAutoFit(false);
    canvasRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    map.setView(entry.marker.getLatLng(), Math.max(map.getZoom(), 5), { animate: false });
    entry.marker.openPopup();
  };

  useImperativeHandle(ref, () => ({
    focusPeer: (ip) => focus(entriesRef.current.get(`peer:${ip}`)),
    focusServer: () => focus(serverRef.current),
  }));

  const handleFit = () => {
    autoFitRef.current = true;
    setAutoFit(true);
    fitSigRef.current = pointsRef.current.map((p) => p.join(',')).sort().join('|');
    fitTo(pointsRef.current);
  };

  return (
    <div className="map">
      <div ref={canvasRef} className="map__canvas" aria-label="Network map" />
      <button
        type="button"
        className="btn map__fit"
        onClick={handleFit}
        aria-pressed={autoFit}
        title={autoFit ? 'Auto-fit is on' : 'Fit to the server and all peers, and keep fitting'}
      >
        <Icon name="fit" /> Fit{autoFit ? ' · auto' : ''}
      </button>
      {tilesDown && <p className="map__notice" role="status">Map tiles unavailable</p>}
    </div>
  );
}
