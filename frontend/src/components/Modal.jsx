import { useEffect, useId, useRef } from 'react';
import Icon from './Icon.jsx';

// Dialog shell: closes on Escape and on a click outside, moves focus in on
// open and hands it back on close.
export default function Modal({ title, onClose, children, wide = false }) {
  const titleId = useId();
  const boxRef = useRef(null);
  // The latest onClose without re-running the focus logic on every parent render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement;
    const box = boxRef.current;
    const first = box.querySelector('input, select, textarea, button:not(.modal__close)');
    (first || box).focus();

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const items = box.querySelectorAll('a[href], button:not([disabled]), input, select, textarea');
        if (!items.length) return;
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, []);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={boxRef}
        className={wide ? 'modal modal--wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal__head">
          <h2 id={titleId} className="modal__title">{title}</h2>
          <button type="button" className="btn btn--ghost btn--icon modal__close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
