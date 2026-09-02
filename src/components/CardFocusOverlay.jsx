import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { m, AnimatePresence } from 'motion/react';
import PlayerCard from './PlayerCard';
import { getCardSpecialties } from '../data/specialties';
import SpecialtyIcon from './SpecialtyIcon';
import { fadeIn } from '../lib/motion';
import useDialogFocusTrap from '../lib/useDialogFocusTrap';
import styles from './CardFocusOverlay.module.css';

const CARD_H = 580;

// `action` (optional) is the caller's per-card action — { label, disabled },
// fired through `onAction` — rendered as a primary button so the player commits
// to it while looking at the whole card instead of tapping a thumbnail blind.
export default function CardFocusOverlay({ card, onClose, action = null, onAction }) {
  const [flipped, setFlipped] = useState(false);
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  const cardRef = useRef(card);
  useDialogFocusTrap(Boolean(card), dialogRef, closeRef);
  useEffect(() => {
    cardRef.current = card;
  });

  // The dock chip sharing this card's layoutId reclaims it the instant
  // `onClose` actually fires (its own `focusCardId` prop goes null). If this
  // overlay's PlayerCard were STILL claiming that same id in the same
  // render — which a direct onClose() call would cause, since React batches
  // this component's own state update with the parent's into one commit —
  // two mounted elements would hold the identical layoutId at once. Framer
  // Motion doesn't arbitrate that: the loser is left as a stuck, never-
  // settling duplicate card. requestClose releases the id one frame ahead of
  // the real close so the handoff to the dock is always a clean single claim.
  const [releasingId, setReleasingId] = useState(null);

  // Reset the flip when a different card is focused (during render, no effect).
  const prevId = useRef(card?.id);
  if (prevId.current !== card?.id) {
    prevId.current = card?.id;
    if (flipped) setFlipped(false);
    if (releasingId) setReleasingId(null);
  }

  function requestClose() {
    if (!card) return;
    const closingId = card.id;
    setReleasingId(closingId);
    requestAnimationFrame(() => {
      if (cardRef.current?.id === closingId) onClose();
    });
  }

  useEffect(() => {
    if (!card) return;
    const onKey = (e) => e.key === 'Escape' && requestClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  const scale = card ? Math.min(1, (window.innerHeight * 0.82) / CARD_H) : 0;
  const specialties = card ? getCardSpecialties(card) : [];

  // AnimatePresence owns the mount/unmount here (rather than the caller
  // conditionally rendering this component) so the backdrop actually gets an
  // exit animation instead of the instant cut a bare `if (!card) return null`
  // produces — this component is always mounted, `card` toggling its content.
  return createPortal(
    <AnimatePresence>
      {card && (
        <m.div
          ref={dialogRef}
          className={styles.backdrop}
          variants={fadeIn}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={requestClose}
          role="dialog"
          aria-modal="true"
          aria-label={`${card.player ?? 'Player'} card details`}
        >
          <button ref={closeRef} className={styles.close} onClick={requestClose} aria-label="Close">✕</button>

          <div className={styles.focusContainer} onClick={(e) => e.stopPropagation()}>
            <PlayerCard
              card={card}
              layoutId={releasingId === card.id ? undefined : `card-${card.id}`}
              displayScale={scale}
              flippable
              flipped={flipped}
              onClick={() => setFlipped((f) => !f)}
            />

            {/* Specialties Panel */}
            <div className={styles.specSidebar}>
              <span className={styles.specSidebarTitle}>SPECIALTIES</span>
              {specialties.length === 0 ? (
                <p className={styles.noSpecs}>No active specialties</p>
              ) : (
                <div className={styles.specCardsList}>
                  {specialties.map(spec => (
                    <div key={spec.key} className={styles.specDetailCard}>
                      <div className={styles.specHeader}>
                        <span className={styles.specBadgeIcon}><SpecialtyIcon spec={spec.key} size="64%" /></span>
                        <span className={styles.specName}>{spec.name}</span>
                      </div>
                      <p className={styles.specDesc}>{spec.desc}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={styles.footer} onClick={(e) => e.stopPropagation()}>
            {action && (
              <button
                className={styles.action}
                disabled={action.disabled}
                onClick={() => { onAction?.(); requestClose(); }}
              >
                {action.label}
              </button>
            )}
            <p className={styles.hint}>click card to flip · esc to close</p>
          </div>
        </m.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
