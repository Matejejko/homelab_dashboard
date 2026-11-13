import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import ServiceCard from './ServiceCard.jsx';

export default function GroupSection({ name, services, addresses, overrides, onDrop, onRename, onDelete, onEdit }) {
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.select();
  }, [editing]);

  const startEditing = () => {
    setValue(name);
    setEditing(true);
  };

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) onRename(name, trimmed);
    setEditing(false);
  };

  return (
    <section className="group" aria-label={`Group ${name}`}>
      <div className="group__head">
        {editing ? (
          <input
            ref={inputRef}
            className="input input--inline"
            aria-label="Group name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <h3 className="group__title" onDoubleClick={startEditing}>{name}</h3>
        )}
        <span className="count">{services.length}</span>
        <span className="group__tools">
          <button type="button" className="btn btn--ghost btn--icon" onClick={startEditing} aria-label={`Rename group ${name}`} title="Rename group">
            <Icon name="pencil" />
          </button>
          <button type="button" className="btn btn--ghost btn--icon btn--danger" onClick={() => onDelete(name)} aria-label={`Delete group ${name}`} title="Delete group">
            <Icon name="trash" />
          </button>
        </span>
      </div>
      <div
        className={over ? 'cards dropzone dropzone--over' : 'cards dropzone'}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const service = e.dataTransfer.getData('text/plain');
          if (service) onDrop(service, name);
        }}
      >
        {services.map((svc) => (
          <ServiceCard
            key={svc.name}
            svc={svc}
            addresses={addresses}
            override={overrides[svc.name]}
            draggable
            onEdit={onEdit}
          />
        ))}
        {services.length === 0 && <p className="empty dropzone__hint">Drag services here</p>}
      </div>
    </section>
  );
}
