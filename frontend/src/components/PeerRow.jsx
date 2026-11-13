import { formatBytes } from '../format.js';
import DirectionTag from './DirectionTag.jsx';
import NetBadge from './NetBadge.jsx';

// One peer. A button when it can be shown on the map, plain text otherwise.
export default function PeerRow({ peer, accounting, detail, onClick }) {
  const traffic = accounting && peer.bytes_in != null
    ? `↓ ${formatBytes(peer.bytes_in)} ↑ ${formatBytes(peer.bytes_out)}`
    : null;
  const body = (
    <>
      <span className="peer__top">
        <NetBadge net={peer.net} />
        <span className="peer__name">{peer.name || peer.ip}</span>
        <DirectionTag direction={peer.direction} />
      </span>
      <span className="peer__meta">
        {peer.name ? `${peer.ip} · ` : ''}
        {detail}
      </span>
      <span className="peer__meta">
        {peer.flows} {peer.flows === 1 ? 'flow' : 'flows'}
        {traffic ? ` · ${traffic}` : ''}
        {peer.services && peer.services.length ? ` · ${peer.services.join(', ')}` : ''}
      </span>
    </>
  );
  return (
    <li>
      {onClick
        ? <button type="button" className="peer peer--link" onClick={onClick}>{body}</button>
        : <div className="peer">{body}</div>}
    </li>
  );
}
