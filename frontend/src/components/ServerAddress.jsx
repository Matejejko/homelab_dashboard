export default function ServerAddress({ label, net, ip }) {
  return (
    <span className={`addr net--${net}`}>
      <span className="net__shape" aria-hidden="true" />
      <span className="addr__label">{label}</span>
      <span className={ip ? 'addr__ip' : 'addr__ip addr__ip--none'}>{ip || 'none'}</span>
    </span>
  );
}
