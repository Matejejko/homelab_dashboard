import { useState } from 'react';
import Icon from './Icon.jsx';

// Inline replacement for the old prompt(): Enter adds, Escape cancels.
export default function AddGroup({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  const close = () => {
    setOpen(false);
    setValue('');
  };

  if (!open) {
    return (
      <button type="button" className="btn btn--small" onClick={() => setOpen(true)}>
        <Icon name="plus" /> Group
      </button>
    );
  }
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onAdd(value.trim());
        close();
      }}
    >
      <input
        className="input input--inline"
        aria-label="New group name"
        placeholder="New group name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && close()}
        autoFocus
      />
      <button type="submit" className="btn btn--small btn--primary">Add</button>
      <button type="button" className="btn btn--small" onClick={close}>Cancel</button>
    </form>
  );
}
