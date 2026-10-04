import { useEffect, useRef } from 'react';

// A modal on the native <dialog>: focus trap, Esc and the backdrop come free.
// side="left" slides it in as the menu drawer; size="full" is a wide match screen (full-screen
// on a phone) whose title is for screen readers only, since the screen itself names the teams;
// the default is a centred panel. `head` puts content in the sticky top bar beside the close button.
export default function Sheet({ open, onClose, title, head, side, size, pickedSide, style, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="sheet" data-side={side} data-size={size} data-picked-side={pickedSide} style={style} onClose={() => { if (open) onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }} aria-label={title}>
      <div className="sheet-head">
        <h2 className={size === 'full' ? 'sr' : undefined}>{title}</h2>
        {head}
        <button className="icon" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
        </button>
      </div>
      <div className="sheet-body">{open && children}</div>
    </dialog>
  );
}
