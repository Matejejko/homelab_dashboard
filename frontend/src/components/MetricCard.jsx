import Icon from './Icon.jsx';

// One measured thing: name on the left, current value on the right, a line of
// context, then its chart. Values are plain text; colour belongs to the marks.
export default function MetricCard({ icon, label, value, sub, subTitle, side, children }) {
  return (
    <section className="metric" aria-label={label}>
      <header className="metric__head">
        <h3 className="metric__label"><Icon name={icon} /> {label}</h3>
        <div className="metric__value">{value}</div>
      </header>
      <p className="metric__sub">
        <span className="metric__sub-main" title={subTitle || undefined}>{sub}</span>
        {side && <span className="metric__sub-side">{side}</span>}
      </p>
      {children}
    </section>
  );
}
