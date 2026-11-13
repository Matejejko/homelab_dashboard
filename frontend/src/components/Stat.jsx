export default function Stat({ label, children }) {
  return (
    <section className="stat" aria-label={label}>
      <h3 className="stat__label">{label}</h3>
      {children}
    </section>
  );
}
