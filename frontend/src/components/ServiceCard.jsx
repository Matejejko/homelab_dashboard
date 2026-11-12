import AccessLink from './AccessLink.jsx';
import Icon from './Icon.jsx';

export default function ServiceCard({ svc, addresses, override, draggable = false, onEdit }) {
  const name = (override && override.name) || svc.name;
  const icon = (override && override.icon) || svc.icon || '🔧';
  const desc = override && override.desc != null ? override.desc : svc.desc;
  const online = svc.status === 'online';
  const { port } = svc;
  const { lan, zerotier, tailscale } = addresses;

  // Same URL rules as before: host port on each network, or the discovered URL on the LAN.
  const lanUrl = port && lan
    ? `http://${lan}:${port}`
    : lan && svc.url ? svc.url.replace('localhost', lan) : svc.url;
  const ztUrl = port && zerotier ? `http://${zerotier}:${port}` : null;
  const tsUrl = port && tailscale ? `http://${tailscale}:${port}` : null;

  return (
    <article
      className={`svc ${online ? 'svc--online' : 'svc--offline'}`}
      draggable={draggable}
      onDragStart={draggable ? (e) => {
        e.dataTransfer.setData('text/plain', svc.name);
        e.dataTransfer.effectAllowed = 'move';
      } : undefined}
    >
      <div className="svc__top">
        <span className="svc__icon" aria-hidden="true">{icon}</span>
        <h4 className="svc__name">{name}</h4>
        <button
          type="button"
          className="btn btn--ghost btn--icon svc__edit"
          onClick={() => onEdit(svc)}
          aria-label={`Edit ${name}`}
          title="Edit service"
        >
          <Icon name="pencil" />
        </button>
      </div>
      {desc && <p className="svc__desc">{desc}</p>}
      <p className="svc__status">
        <span className={`status status--${online ? 'ok' : 'bad'}`}>
          <span className="status__dot" aria-hidden="true" />
          {online ? 'online' : 'offline'}
        </span>
        {svc.ping_ms != null && <span className="svc__ping">{svc.ping_ms} ms</span>}
        {port && <span className="svc__port">:{port}</span>}
      </p>
      <div className="svc__links">
        <AccessLink label="LAN" net="lan" url={lanUrl} missing="No LAN address or URL for this service" />
        <AccessLink label="ZeroTier" net="zerotier" url={ztUrl} missing="No ZeroTier address, or no host port" />
        <AccessLink label="Tailscale" net="tailscale" url={tsUrl} missing="No Tailscale address, or no host port" />
      </div>
    </article>
  );
}
