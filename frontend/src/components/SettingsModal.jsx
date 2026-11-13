import { useState } from 'react';
import { NET_LABELS } from '../format.js';
import { PIN_TYPES, hasLocation } from '../storage.js';
import ChangePassword from './ChangePassword.jsx';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import NetBadge from './NetBadge.jsx';

const parseCoord = (text, limit) => {
  const value = Number.parseFloat(String(text).replace(',', '.'));
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
};

export default function SettingsModal({ serverLocation, defaultLocation, pins, onSave, onClose }) {
  const custom = hasLocation(serverLocation);
  const [lat, setLat] = useState(custom ? String(serverLocation.lat) : '');
  const [lng, setLng] = useState(custom ? String(serverLocation.lng) : '');
  const [list, setList] = useState(pins);
  const [draft, setDraft] = useState({ name: '', lat: '', lng: '', type: 'lan' });
  const [error, setError] = useState(null);
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);

  const addPin = () => {
    const pinLat = parseCoord(draft.lat, 90);
    const pinLng = parseCoord(draft.lng, 180);
    if (!draft.name.trim() || pinLat === null || pinLng === null) {
      setError('A pin needs a name, a latitude between -90 and 90 and a longitude between -180 and 180.');
      return;
    }
    setList([...list, { name: draft.name.trim(), lat: pinLat, lng: pinLng, type: draft.type }]);
    setDraft({ name: '', lat: '', lng: '', type: 'lan' });
    setError(null);
  };

  const save = (event) => {
    event.preventDefault();
    let location = { lat: 0, lng: 0 };            // (0, 0) = follow the server's own setting
    if (lat.trim() || lng.trim()) {
      const parsedLat = parseCoord(lat, 90);
      const parsedLng = parseCoord(lng, 180);
      if (parsedLat === null || parsedLng === null) {
        setError('Server location: enter both a latitude (-90 to 90) and a longitude (-180 to 180), or clear both.');
        return;
      }
      location = { lat: parsedLat, lng: parsedLng };
    }
    onSave({ serverLocation: location, devices: list });
    onClose();
  };

  if (changing) {
    return (
      <Modal title="Change password" onClose={() => setChanging(false)}>
        <ChangePassword
          onCancel={() => setChanging(false)}
          onDone={() => {
            setChanging(false);
            setChanged(true);
          }}
        />
      </Modal>
    );
  }

  const fallback = hasLocation(defaultLocation)
    ? `Empty uses the server's setting (${defaultLocation.lat}, ${defaultLocation.lng}).`
    : 'Empty uses the server’s setting, which is not configured.';

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <fieldset className="fieldset">
          <legend className="fieldset__legend">Server location</legend>
          <div className="row">
            <label className="field">
              <span className="field__label">Latitude</span>
              <input className="input" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="48.1486" />
            </label>
            <label className="field">
              <span className="field__label">Longitude</span>
              <input className="input" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="17.1077" />
            </label>
          </div>
          <p className="hint">A location set here wins over the server&rsquo;s. {fallback}</p>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Manual map pins</legend>
          {list.length === 0 && <p className="hint">No manual pins.</p>}
          <ul className="pinlist">
            {list.map((pin, index) => (
              <li key={`${pin.name}:${pin.lat}:${pin.lng}:${index}`} className="pinlist__row">
                <NetBadge net={pin.type} />
                <span className="pinlist__name">{pin.name}</span>
                <span className="pinlist__pos">{pin.lat}, {pin.lng}</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--danger"
                  onClick={() => setList(list.filter((_, i) => i !== index))}
                  aria-label={`Remove pin ${pin.name}`}
                >
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
          <div className="row row--pins">
            <label className="field field--grow">
              <span className="field__label">Name</span>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="My laptop" />
            </label>
            <label className="field">
              <span className="field__label">Lat</span>
              <input className="input" inputMode="decimal" value={draft.lat} onChange={(e) => setDraft({ ...draft, lat: e.target.value })} placeholder="52.52" />
            </label>
            <label className="field">
              <span className="field__label">Lng</span>
              <input className="input" inputMode="decimal" value={draft.lng} onChange={(e) => setDraft({ ...draft, lng: e.target.value })} placeholder="13.41" />
            </label>
            <label className="field">
              <span className="field__label">Type</span>
              <select className="input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                {PIN_TYPES.map((type) => <option key={type} value={type}>{NET_LABELS[type]}</option>)}
              </select>
            </label>
            <button type="button" className="btn" onClick={addPin}><Icon name="plus" /> Add pin</button>
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Account</legend>
          <div className="row row--center">
            <button type="button" className="btn" onClick={() => setChanging(true)}>
              <Icon name="key" /> Change password
            </button>
            {changed && <span className="notice notice--ok" role="status">Password changed. Other sessions were signed out.</span>}
          </div>
        </fieldset>

        {error && <p className="notice notice--bad" role="alert">{error}</p>}

        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
