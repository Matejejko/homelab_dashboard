import { DIRECTIONS } from '../format.js';

// Flow direction as an arrow plus a word.
export default function DirectionTag({ direction }) {
  const info = DIRECTIONS[direction];
  if (!info) return null;
  return (
    <span className="dir" title={info.long}>
      <span aria-hidden="true">{info.arrow}</span> {info.short}
      <span className="sr-only"> ({info.long})</span>
    </span>
  );
}
