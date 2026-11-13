// Popup and marker content for the map, built from DOM nodes and textContent
// only: peer names, IPs and service names come from the network and from
// labels, and must never be parsed as HTML.

import { DIRECTIONS, NET_LABELS, formatBytes, placeText } from './format.js';

const MAX_POPUP_ROWS = 40;

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const signatures = new WeakMap();

// Rebuilds `node` only when what it shows has changed. Returns true if it did.
function render(node, signature, build) {
  const key = JSON.stringify(signature);
  if (signatures.get(node) === key) return false;
  signatures.set(node, key);
  node.replaceChildren(...build());
  return true;
}

function definitionList(rows) {
  const dl = el('dl', 'popup__rows');
  for (const [term, value] of rows) dl.append(el('dt', null, term), el('dd', null, value));
  return dl;
}

function trafficText(peer, accounting) {
  if (!accounting || peer.bytes_in == null) return 'not counted';
  return `↓ ${formatBytes(peer.bytes_in)}  ↑ ${formatBytes(peer.bytes_out)}`;
}

function directionText(direction) {
  const info = DIRECTIONS[direction];
  return info ? `${info.arrow} ${info.long}` : String(direction);
}

function portsText(ports) {
  const shown = ports.slice(0, 12).join(', ');
  return ports.length > 12 ? `${shown} +${ports.length - 12} more` : shown;
}

function peerRows(peer, accounting) {
  const rows = [];
  if (peer.name) rows.push(['Address', peer.ip]);
  rows.push(['Network', NET_LABELS[peer.net] || peer.net]);
  rows.push(['Direction', directionText(peer.direction)]);
  rows.push(['Flows', String(peer.flows)]);
  rows.push(['Traffic', trafficText(peer, accounting)]);
  if (peer.ports && peer.ports.length) rows.push(['Ports', portsText(peer.ports)]);
  if (peer.services && peer.services.length) rows.push(['Services', peer.services.join(', ')]);
  const basis = peer.geo.source === 'tailscale-endpoint' ? 'endpoint IP estimate' : 'IP estimate';
  rows.push(['Location', `${placeText(peer.geo) || 'unnamed place'} (${basis})`]);
  return rows;
}

export function renderPeerPopup(node, peer, accounting) {
  const title = peer.name || peer.ip;
  const rows = peerRows(peer, accounting);
  return render(node, [title, rows], () => [el('div', 'popup__title', title), definitionList(rows)]);
}

export function renderPinPopup(node, pin) {
  const rows = [
    ['Kind', `Manual pin · ${NET_LABELS[pin.type] || pin.type}`],
    ['Position', `${pin.lat}, ${pin.lng}`],
  ];
  return render(node, [pin.name, rows], () => [el('div', 'popup__title', pin.name), definitionList(rows)]);
}

export function renderServerPopup(node, addresses, sitePeers, accounting) {
  const rows = [];
  if (addresses.lan) rows.push(['LAN', addresses.lan]);
  if (addresses.tailscale) rows.push(['Tailscale', addresses.tailscale]);
  if (addresses.zerotier) rows.push(['ZeroTier', addresses.zerotier]);
  const local = sitePeers.slice(0, MAX_POPUP_ROWS).map((peer) => [
    peer.direction,
    peer.name || peer.ip,
    NET_LABELS[peer.net] || peer.net,
    `${peer.flows} ${peer.flows === 1 ? 'flow' : 'flows'}`,
    accounting && peer.bytes_in != null ? formatBytes(peer.bytes_in + peer.bytes_out) : '',
  ]);

  return render(node, [rows, local, sitePeers.length], () => {
    const parts = [el('div', 'popup__title', 'Server')];
    if (rows.length) parts.push(definitionList(rows));
    if (sitePeers.length) {
      parts.push(el('div', 'popup__subtitle', `Local network · ${sitePeers.length}`));
      const list = el('ul', 'popup__list');
      for (const [direction, name, net, flows, bytes] of local) {
        const info = DIRECTIONS[direction];
        const item = el('li', 'popup__peer');
        const arrow = el('span', 'popup__dir', info ? `${info.arrow} ${info.short}` : direction);
        item.append(arrow, el('span', 'popup__peer-name', name), el('span', 'popup__peer-meta', [net, flows, bytes].filter(Boolean).join(' · ')));
        list.append(item);
      }
      if (sitePeers.length > MAX_POPUP_ROWS) {
        list.append(el('li', 'popup__peer popup__peer--more', `+${sitePeers.length - MAX_POPUP_ROWS} more in the peer list`));
      }
      parts.push(list);
    }
    return parts;
  });
}
