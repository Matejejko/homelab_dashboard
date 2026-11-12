import { useMemo, useRef } from 'react';
import { NET_LABELS } from '../format.js';
import { partitionPeers } from '../peers.js';
import NetworkMap from './NetworkMap.jsx';
import PeerList from './PeerList.jsx';
import ServerAddress from './ServerAddress.jsx';

const EMPTY = [];

export default function NetworkSection({ network, error, server, addresses, pins, theme }) {
  const mapRef = useRef(null);
  const peers = network && Array.isArray(network.peers) ? network.peers : EMPTY;
  const accounting = Boolean(network && network.accounting);
  const { mapped, site, unlocated } = useMemo(
    () => partitionPeers(peers, Boolean(server)),
    [peers, server],
  );

  return (
    <section className="section network" aria-labelledby="network-title">
      <div className="section__head">
        <h2 id="network-title" className="section__title">Network</h2>
        <div className="addrs" aria-label="Server addresses">
          <ServerAddress label="LAN" net="lan" ip={addresses.lan} />
          <ServerAddress label="Tailscale" net="tailscale" ip={addresses.tailscale} />
          <ServerAddress label="ZeroTier" net="zerotier" ip={addresses.zerotier} />
        </div>
      </div>

      {error && <p className="notice notice--bad" role="alert">Network API: {error}</p>}

      <div className="network__body">
        <div className="network__map">
          <NetworkMap
            ref={mapRef}
            server={server}
            addresses={addresses}
            peers={mapped}
            sitePeers={site}
            pins={pins}
            accounting={accounting}
            theme={theme}
          />
          <p className="network__caption">
            Locations are IP-geolocation estimates: city-level at best. Mobile and VPN users appear at
            their carrier or VPN exit.
          </p>
          {!server && (
            <p className="network__caption">
              The server location is not set, so the server and local peers are not drawn. Set it in Settings.
            </p>
          )}
          <ul className="legend" aria-label="Map legend">
            <li className="legend__item"><span className="pin pin--server pin--inline"><span className="pin__shape" /></span>Server</li>
            {Object.entries(NET_LABELS).map(([net, label]) => (
              <li key={net} className="legend__item">
                <span className={`pin pin--${net} pin--inline`}><span className="pin__shape" /></span>{label}
              </li>
            ))}
            <li className="legend__item"><span className="legend__line legend__line--in" />in: dashes move to the server</li>
            <li className="legend__item"><span className="legend__line legend__line--out" />out: dashes move away</li>
            <li className="legend__item"><span className="legend__line legend__line--both" />both: solid</li>
          </ul>
        </div>

        <aside className="network__peers" aria-label="Peers">
          <div className="network__peers-inner">
          <div className="peers__head">
            <h3 className="peers__title">
              Peers <span className="count">{network ? network.total_peers : 0}</span>
            </h3>
            <span className="peers__note">
              {network && network.truncated ? `top ${peers.length} shown · ` : ''}
              {network ? (accounting ? 'ranked by bytes' : 'ranked by flows · byte counters off') : 'loading…'}
            </span>
          </div>
          <PeerList
            mapped={mapped}
            site={site}
            unlocated={unlocated}
            accounting={accounting}
            onFocusPeer={(ip) => mapRef.current && mapRef.current.focusPeer(ip)}
            onFocusServer={() => mapRef.current && mapRef.current.focusServer()}
          />
          </div>
        </aside>
      </div>
    </section>
  );
}
