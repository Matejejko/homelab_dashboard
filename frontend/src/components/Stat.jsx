import Icon from './Icon.jsx';

export default function Stat({ label, icon, children }) {
  return (
    <section className="stat" aria-label={label}>
      <h3 className="stat__label">{icon && <Icon name={icon} />} {label}</h3>
      {children}
    </section>
  );
}
