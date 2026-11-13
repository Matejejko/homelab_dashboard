// Decides where each peer of /api/network is shown. Nothing here invents a
// position: a peer is on the map only at coordinates the backend derived from
// real data, or at the server site when it is on the local network.

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export function partitionPeers(peers, hasServerSite) {
  const mapped = [];      // own marker and line
  const site = [];        // folded into the server marker's "Local network" badge
  const unlocated = [];   // list only, with a reason

  for (const peer of Array.isArray(peers) ? peers : []) {
    if (!peer || typeof peer !== 'object' || typeof peer.ip !== 'string') continue;
    const geo = peer.geo;
    const atSite = (geo && geo.source === 'server-site') || peer.unlocated_reason === 'no_server_location';
    if (atSite) {
      // The server location may be set in this browser only (Settings).
      if (hasServerSite) site.push(peer);
      else unlocated.push({ peer, reason: 'no_server_location' });
    } else if (geo && finite(geo.lat) && finite(geo.lng)) {
      mapped.push(peer);
    } else {
      unlocated.push({ peer, reason: peer.unlocated_reason || 'unknown' });
    }
  }
  return { mapped, site, unlocated };
}

// Line weight: log scale of bytes with accounting, of flows without.
export function lineWeight(peer, accounting) {
  const volume = accounting ? (peer.bytes_in || 0) + (peer.bytes_out || 0) : peer.flows || 0;
  const scale = accounting ? Math.log10(1 + volume) / 9 : Math.log10(1 + volume) / 3;   // 1 GB / 1000 flows -> full
  return Math.round((1.25 + Math.min(1, scale) * 4.75) * 4) / 4;
}
