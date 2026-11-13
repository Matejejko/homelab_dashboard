export default function PeerGroup({ title, count, children }) {
  return (
    <section className="peers__group">
      <h4 className="peers__heading">{title} <span className="count">{count}</span></h4>
      <ul className="peers__rows">{children}</ul>
    </section>
  );
}
