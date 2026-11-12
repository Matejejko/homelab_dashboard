import { useState } from 'react';
import AddGroup from './AddGroup.jsx';
import GroupSection from './GroupSection.jsx';
import Icon from './Icon.jsx';
import ServiceCard from './ServiceCard.jsx';

export default function ServiceGrid({
  services, error, loaded, groups, grouped, addresses, overrides,
  onAddGroup, onRenameGroup, onDeleteGroup, onMoveService, onEdit,
}) {
  const [groupedView, setGroupedView] = useState(false);

  return (
    <section className="section" aria-labelledby="services-title">
      <div className="section__head">
        <h2 id="services-title" className="section__title">
          Services <span className="count">{services.length}</span>
        </h2>
        <div className="section__tools">
          <div className="segmented" role="group" aria-label="Service view">
            <button type="button" className="btn btn--small" aria-pressed={!groupedView} onClick={() => setGroupedView(false)}>
              <Icon name="grid" /> All
            </button>
            <button type="button" className="btn btn--small" aria-pressed={groupedView} onClick={() => setGroupedView(true)}>
              <Icon name="list" /> Grouped
            </button>
          </div>
          {groupedView && <AddGroup onAdd={onAddGroup} />}
        </div>
      </div>

      {error && <p className="notice notice--bad" role="alert">Services API: {error}</p>}

      {!groupedView && (
        <div className="cards">
          {services.map((svc) => (
            <ServiceCard key={svc.name} svc={svc} addresses={addresses} override={overrides[svc.name]} onEdit={onEdit} />
          ))}
        </div>
      )}

      {groupedView && groups.map((group) => (
        <GroupSection
          key={group}
          name={group}
          services={grouped[group] || []}
          addresses={addresses}
          overrides={overrides}
          onDrop={onMoveService}
          onRename={onRenameGroup}
          onDelete={onDeleteGroup}
          onEdit={onEdit}
        />
      ))}

      {loaded && services.length === 0 && !error && (
        <p className="empty">
          No services discovered yet. Services running in Docker or k3s appear automatically.
        </p>
      )}
    </section>
  );
}
