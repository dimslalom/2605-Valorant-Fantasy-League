import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import PlayerCard from './PlayerCard';
import styles from './CardFocusOverlay.module.css';

const CARD_H = 580;

export default function CardFocusOverlay({ card, onClose }) {
  const [flipped, setFlipped] = useState(false);

  // Always open showing the front of the newly focused card
  useEffect(() => setFlipped(false), [card?.id]);

  useEffect(() => {
    if (!card) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, onClose]);

  if (!card) return null;

  const scale = Math.min(1, (window.innerHeight * 0.82) / CARD_H);

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
      <div className={styles.cardWrap} onClick={(e) => e.stopPropagation()}>
        <PlayerCard
          card={card}
          displayScale={scale}
          flippable
          flipped={flipped}
          onClick={() => setFlipped((f) => !f)}
        />
      </div>
      <p className={styles.hint}>click card to flip · esc to close</p>
    </div>,
    document.body
  );
}
