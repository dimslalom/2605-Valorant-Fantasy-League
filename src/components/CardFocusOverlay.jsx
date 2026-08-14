import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PlayerCard from './PlayerCard';
import { getCardSpecialties } from '../data/specialties';
import SpecialtyIcon from './SpecialtyIcon';
import styles from './CardFocusOverlay.module.css';

const CARD_H = 580;

// `action` (optional) is the caller's per-card action — { label, disabled },
// fired through `onAction` — rendered as a primary button so the player commits
// to it while looking at the whole card instead of tapping a thumbnail blind.
export default function CardFocusOverlay({ card, onClose, action = null, onAction }) {
  const [flipped, setFlipped] = useState(false);

  // Reset the flip when a different card is focused (during render, no effect).
  const prevId = useRef(card?.id);
  if (prevId.current !== card?.id) {
    prevId.current = card?.id;
    if (flipped) setFlipped(false);
  }

  useEffect(() => {
    if (!card) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, onClose]);

  if (!card) return null;

  const scale = Math.min(1, (window.innerHeight * 0.82) / CARD_H);
  const specialties = getCardSpecialties(card);

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>

      <div className={styles.focusContainer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.cardWrap}>
          <PlayerCard
            card={card}
            displayScale={scale}
            flippable
            flipped={flipped}
            onClick={() => setFlipped((f) => !f)}
          />
        </div>

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
            onClick={() => { onAction?.(); onClose(); }}
          >
            {action.label}
          </button>
        )}
        <p className={styles.hint}>click card to flip · esc to close</p>
      </div>
    </div>,
    document.body
  );
}
