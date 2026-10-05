import { useEffect, useRef } from 'react';

// A modal on the native <dialog>: focus trap, Esc and the backdrop come free. Esc is caught on
// `cancel` as well as `close`, since some browsers close the dialog without ever firing `close`.
// side="left" slides it in as the menu drawer; size="full" is a wide match screen (full-screen
// on a phone) whose title is for screen readers only, since the screen itself names the teams;
// the default is a centred panel. `head` puts content in the sticky top bar beside the close button.
// A click on the backdrop targets the dialog itself, but so does a click whose press and release
// land on different children (a card that lifts as you press it), so check the point too.
const outside = (e, el) => {
  const r = el.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
};

export default function Sheet({ open, onClose, title, head, side, size, pickedSide, style, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="sheet" data-side={side} data-size={size} data-picked-side={pickedSide} style={style} onClose={() => { if (open) onClose(); }} onCancel={() => { if (open) onClose(); }} onClick={e => { if (e.target === ref.current && outside(e, ref.current)) onClose(); }} aria-label={title}>
      <div className="sheet-head">
        <h2 className={size === 'full' || (side === 'left' && head) ? 'sr' : undefined}>{title}</h2>
        {head}
        <button className="icon" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
        </button>
      </div>
      <div className="sheet-body">{open && children}</div>
    </dialog>
  );
}
