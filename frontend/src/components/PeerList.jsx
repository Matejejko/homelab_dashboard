import { placeText, reasonText } from '../format.js';
import PeerGroup from './PeerGroup.jsx';
import PeerRow from './PeerRow.jsx';

export default function PeerList({ mapped, site, unlocated, accounting, onFocusPeer, onFocusServer }) {
  if (mapped.length + site.length + unlocated.length === 0) {
    return <p className="empty">No active connections detected.</p>;
  }

  return (
    <div className="peers">
      {mapped.length > 0 && (
        <PeerGroup title="On map" count={mapped.length}>
          {mapped.map((peer) => (
            <PeerRow
              key={peer.ip}
              peer={peer}
              accounting={accounting}
              detail={placeText(peer.geo) || 'unnamed place'}
              onClick={() => onFocusPeer(peer.ip)}
            />
          ))}
        </PeerGroup>
      )}

      {site.length > 0 && (
        <PeerGroup title="Local network" count={site.length}>
          {site.map((peer) => (
            <PeerRow key={peer.ip} peer={peer} accounting={accounting} detail="at the server site" onClick={onFocusServer} />
          ))}
        </PeerGroup>
      )}

      {unlocated.length > 0 && (
        <PeerGroup title="Not on map" count={unlocated.length}>
          {unlocated.map(({ peer, reason }) => (
            <PeerRow key={peer.ip} peer={peer} accounting={accounting} detail={reasonText(reason)} />
          ))}
        </PeerGroup>
      )}
    </div>
  );
}
