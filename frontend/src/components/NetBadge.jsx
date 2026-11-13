import { NET_LABELS } from '../format.js';

// Network type: colour, shape and text together.
export default function NetBadge({ net }) {
  return (
    <span className={`net net--${net}`}>
      <span className="net__shape" aria-hidden="true" />
      {NET_LABELS[net] || net}
    </span>
  );
}
