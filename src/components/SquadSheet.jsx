import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'motion/react';
import PlayerCard from './PlayerCard';
import PlayerPortrait from './PlayerPortrait';
import useMediaQuery from '../lib/useMediaQuery';
import { previewScale } from '../lib/squadSheetPreview';
import { DUR, EASE } from '../lib/motion';
import useDialogFocusTrap from '../lib/useDialogFocusTrap';
import styles from './SquadSheet.module.css';

// The squad tab: the same photo band as the review screen's IGL pick (faces
// rising from the bottom, shadowed background), reused as the one place to
// see — and sometimes act on — the roster. Held-Tab peek, the SQUAD button,
// or pinned open by whichever phase needs a card picked.
//
// The band itself stays photos only — that's still the right call, see below
// — but hovering (or, on touch, tapping) a face now raises a real PlayerCard
// above the sheet, the same trick SquadDock already uses for its own chips.
// That's what actually answers "which one has the numbers I want": stamping
// a bespoke stat readout onto an overlapping, 260px-wide portrait never would
// have fit five players' worth of data without a rewrite of the band itself.
//
// action: {
//   prompt, dismissible, skip?,
//   pickable?: false,       // prompt/pin only — the pick happens elsewhere
//                           // (e.g. SquadHero's own clickable faces)
//   onPick(card), isEligible?(card),  // required unless pickable: false
//   confirmPrompt?(card),    // touch step 2 wording; defaults to
//                            // `${prompt}: ${card.player}`
// }
function useViewportHeight() {
  const [height, setHeight] = useState(
    () => (typeof window !== 'undefined' ? window.innerHeight : 0),
  );
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return height;
}

export default function SquadSheet({
  open,
  onClose,
  roster,
  iglId,
  squadName,
  power, // { power, base, chem, lines } | null
  action = null,
  children,
}) {
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  const dismissible = !action || action.dismissible !== false;
  const canPick = Boolean(action) && action.pickable !== false;
  const coarse = useMediaQuery('(hover: none)');
  const mobile = useMediaQuery('(max-width: 680px)');
  const viewportHeight = useViewportHeight();
  const scale = previewScale(viewportHeight, mobile);
  useDialogFocusTrap(open, dialogRef, dismissible ? closeRef : undefined);

  const [previewId, setPreviewId] = useState(null);
  const [armedId, setArmedId] = useState(null);

  // Re-arming resets whenever the action itself changes identity (a fresh
  // pack pick, a different shop target, …) so a stale confirm can't fire
  // against the wrong pick.
  const actionKey = action ? `${action.prompt}:${canPick}` : null;
  const prevActionKey = useRef(actionKey);
  if (prevActionKey.current !== actionKey) {
    prevActionKey.current = actionKey;
    if (armedId) setArmedId(null);
    if (previewId) setPreviewId(null);
  }

  // Clears any live preview/arm before actually closing — covers every
  // user-driven dismiss (Escape, the close button, the backdrop). A phase
  // moving on from under the sheet is covered separately, by the actionKey
  // reset above (the action's identity changes at the same time).
  function requestClose() {
    setPreviewId(null);
    setArmedId(null);
    onClose();
  }

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape' && dismissible) {
        setPreviewId(null);
        setArmedId(null);
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);

  if (!open) return null;

  const mid = (roster.length - 1) / 2;
  const armedCard = armedId ? roster.find(c => c.id === armedId) : null;
  const previewCard = roster.find(c => c.id === previewId) ?? null;

  function faceClick(card, eligible) {
    if (!canPick || !eligible) return;
    if (!coarse) { action.onPick(card); return; }
    if (armedId === card.id) { action.onPick(card); setArmedId(null); setPreviewId(null); return; }
    setArmedId(card.id);
    setPreviewId(card.id);
  }

  return createPortal(
    <div
      ref={dialogRef}
      className={styles.backdrop}
      onClick={dismissible ? requestClose : undefined}
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-label={`${squadName || 'Your squad'} scoreboard`}
    >
      {dismissible && (
        <button ref={closeRef} className={styles.close} onClick={requestClose} aria-label="Close">✕</button>
      )}

      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        {previewCard && scale > 0 && (
          <div className={styles.preview} aria-hidden="true">
            <PlayerCard card={previewCard} displayScale={scale} tilt={false} />
          </div>
        )}

        {armedCard ? (
          <div className={styles.promptBand}>
            <span>{action.confirmPrompt ? action.confirmPrompt(armedCard) : `${action.prompt}: ${armedCard.player}`}</span>
            <div className={styles.confirmGroup}>
              <button type="button" className={styles.cancelBtn} onClick={() => { setArmedId(null); setPreviewId(null); }}>
                Cancel
              </button>
              <button type="button" className={styles.confirmBtn} onClick={() => { action.onPick(armedCard); setArmedId(null); }}>
                Confirm
              </button>
            </div>
          </div>
        ) : action && (
          <div className={styles.promptBand}>
            <span>{action.prompt}</span>
            {action.skip && (
              <button type="button" className={styles.skipBtn} onClick={action.skip.onClick}>
                {action.skip.label}
              </button>
            )}
          </div>
        )}

        {roster.length === 0 ? (
          <p className={styles.empty}>Draft five players to build your squad.</p>
        ) : (
          <div className={styles.band}>
            {roster.map((card, i) => {
              const eligible = !canPick || (action.isEligible ? action.isEligible(card) : true);
              const Tag = canPick ? m.button : m.div;
              const armed = armedId === card.id;
              return (
                <Tag
                  key={card.id}
                  type={canPick ? 'button' : undefined}
                  className={[
                    styles.face,
                    canPick && eligible ? styles.facePickable : '',
                    canPick && !eligible ? styles.faceIneligible : '',
                    armed ? styles.faceArmed : '',
                  ].join(' ')}
                  style={{ '--i': i, zIndex: armed ? 25 : Math.round(10 - Math.abs(i - mid)) }}
                  // The two-tap touch confirm's step-1 moment: a brief accent
                  // ring pulse on top of the existing scale-up, so "tap again
                  // to confirm" reads as a distinct event rather than just a
                  // bigger photo. Color/shadow only (no scale/transform here
                  // — that's already the CSS .faceArmed rule's job), so it
                  // stays legible under reduced motion too.
                  animate={armed ? { boxShadow: ['0 0 0 0px transparent', '0 0 0 6px var(--accent-soft)', '0 0 0 0px transparent'] } : { boxShadow: '0 0 0 0px transparent' }}
                  transition={armed ? { duration: DUR.hero, ease: EASE.out } : { duration: 0 }}
                  onClick={() => faceClick(card, eligible)}
                  onMouseEnter={() => setPreviewId(card.id)}
                  onMouseLeave={() => setPreviewId((id) => (id === card.id ? null : id))}
                  onFocus={() => setPreviewId(card.id)}
                  onBlur={() => setPreviewId((id) => (id === card.id ? null : id))}
                  aria-label={canPick ? `${action.prompt}: ${card.player}` : card.player}
                >
                  <PlayerPortrait card={card} fluid loading="lazy" />
                  {card.id === iglId && <span className={styles.iglTag}>IGL</span>}
                </Tag>
              );
            })}
          </div>
        )}

        <div className={styles.stats}>
          <span className={styles.squadName}>{squadName || 'Your squad'}</span>
          {power && (
            <span className={styles.power}>
              Power <b>{power.power.toFixed(1)}</b>
              <i className={power.chem >= 0 ? styles.pos : styles.neg}>
                {power.chem >= 0 ? '+' : ''}{power.chem} chem
              </i>
            </span>
          )}
          {children}
        </div>

        {dismissible && <p className={styles.hint}>esc to close</p>}
      </div>
    </div>,
    document.body,
  );
}
