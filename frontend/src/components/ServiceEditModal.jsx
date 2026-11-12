import { useState } from 'react';
import Modal from './Modal.jsx';

export default function ServiceEditModal({ svc, override, groups, group, onSave, onReset, onClose }) {
  const existing = override || {};
  const [name, setName] = useState(existing.name || svc.name);
  const [icon, setIcon] = useState(existing.icon || svc.icon || '');
  const [desc, setDesc] = useState(existing.desc != null ? existing.desc : svc.desc || '');
  const [target, setTarget] = useState(group);

  const save = (event) => {
    event.preventDefault();
    onSave(svc.name, { name: name.trim() || svc.name, icon: icon || svc.icon, desc }, target);
    onClose();
  };

  return (
    <Modal title="Edit service" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span className="field__label">Display name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Icon (emoji)</span>
          <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="e.g. 📺" />
        </label>
        <label className="field">
          <span className="field__label">Description</span>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Media server" />
        </label>
        <label className="field">
          <span className="field__label">Group</span>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>

        <dl className="facts">
          <dt>Original name</dt><dd>{svc.name}</dd>
          {svc.port && (<><dt>Port</dt><dd>{svc.port}</dd></>)}
          {svc.url && (<><dt>URL</dt><dd className="facts__break">{svc.url}</dd></>)}
          {svc.group && (<><dt>Detected group</dt><dd>{svc.group}</dd></>)}
        </dl>

        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              onReset(svc.name);
              onClose();
            }}
          >
            Reset to default
          </button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
