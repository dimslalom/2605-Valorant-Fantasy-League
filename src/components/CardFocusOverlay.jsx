import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { m, AnimatePresence } from 'motion/react';
import PlayerCard from './PlayerCard';
import { getCardSpecialties } from '../data/specialties';
import SpecialtyIcon from './SpecialtyIcon';
import { fadeIn } from '../lib/motion';
import { countryName, regionFullName } from '../lib/utils';
import useDialogFocusTrap from '../lib/useDialogFocusTrap';
import styles from './CardFocusOverlay.module.css';
import { STAGE_LABEL } from '../engine/endless/career';

const LEAGUE_LABEL = { t2: 'Challengers', icon: 'Icons', vct: 'VCT' };

const CARD_W = 400;
const CARD_H = 580;

// Where each callout's leader touches the card, as a share of the card's
// height. These are the marks themselves, measured off the card face: the
// rating sits at 8%, the flag at 28%, the specialty rail around the middle
// and the club crest in the stat panel at 92%. The line points at the thing
// it is talking about, so it has to follow the art.
const AT_RATING = '9%';
const AT_ORIGIN = '28%';
const AT_SPECIALTIES = '46%';
const AT_CLUB = '89%';

// `action` (optional) is the caller's per-card action - { label, disabled },
// fired through `onAction` - rendered as a primary button so the player commits
// to it while looking at the whole card instead of tapping a thumbnail blind.
// Ratings live in a narrow band; anchoring the bar at 50 makes a 3-point
// difference visible instead of a rounding error on a 0-100 track.
const RATING_FLOOR = 50;
const RATING_TOP = 99;
const pct = rating => ((rating - RATING_FLOOR) / (RATING_TOP - RATING_FLOOR)) * 100;
const capitalize = str => str.charAt(0).toUpperCase() + str.slice(1);

function cardScale() {
  const { innerWidth: w, innerHeight: h } = window;
  if (w <= 960 || h <= 620) return Math.min(0.62, (h * 0.46) / CARD_H, (w * 0.8) / CARD_W);
  return Math.min(0.95, (h * 0.72) / CARD_H, (w * 0.42) / CARD_W);
}

export default function CardFocusOverlay({ card, onClose, action = null, onAction, signals = null }) {
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
  // render - which a direct onClose() call would cause, since React batches
  // this component's own state update with the parent's into one commit -
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

  // The card IS the page here, so it runs near native size rather than
  // sharing the room with a panel. Once the annotations lose their margins
  // and stack underneath (the same 960px the stylesheet switches at), the
  // card has to give most of the screen back to them instead.
  const scale = card ? cardScale() : 0;
  const specialties = card ? getCardSpecialties(card) : [];

  // AnimatePresence owns the mount/unmount here (rather than the caller
  // conditionally rendering this component) so the backdrop actually gets an
  // exit animation instead of the instant cut a bare `if (!card) return null`
  // produces - this component is always mounted, `card` toggling its content.
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

          <div
            className={styles.focusStage}
            style={{ '--card-w': `${CARD_W * scale}px`, '--card-h': `${CARD_H * scale}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* The card is the page. Nothing here repeats what the art
                already says - the five stats, the agents and the org crest
                are on the card and its back. These are the things a card
                cannot tell you, each on a leader line pointing at the mark
                it explains. */}
            <div className={styles.cardAnchor} data-flipped={flipped ? 'true' : undefined}>
              <PlayerCard
                card={card}
                layoutId={releasingId === card.id ? undefined : `card-${card.id}`}
                displayScale={scale}
                flippable
                flipped={flipped}
                onClick={() => setFlipped((f) => !f)}
              />

              {signals ? (
                <Callout side="left" at={AT_RATING} title="Career">
                  <div className={styles.careerTop}>
                    <span className={styles.careerStage} data-stage={signals.stage}>
                      {signals.trend !== 0 && (
                        <i className={styles.careerTrend} data-dir={signals.trend > 0 ? 'up' : 'down'} aria-hidden="true" />
                      )}
                      {STAGE_LABEL[signals.stage]}
                    </span>
                    <span className={styles.careerAge}>Age <b>{signals.age}</b></span>
                  </div>
                  <div
                    className={styles.careerBar}
                    role="img"
                    aria-label={`Rated ${signals.rating}, ceiling ${signals.ceiling}`}
                  >
                    <span className={styles.careerNow} style={{ width: `${pct(signals.rating)}%` }} />
                    {signals.ceiling > signals.rating && (
                      <span
                        className={styles.careerRoom}
                        style={{ left: `${pct(signals.rating)}%`, width: `${pct(signals.ceiling) - pct(signals.rating)}%` }}
                      />
                    )}
                  </div>
                  <div className={styles.careerScale}>
                    <b>{signals.rating}</b>
                    {signals.ceiling > signals.rating && <span>{signals.ceiling}</span>}
                    {signals.drift !== 0 && (
                      <span className={styles.careerDrift} data-dir={signals.trend > 0 ? 'up' : 'down'}>
                        {signals.drift > 0 ? '+' : ''}{signals.drift} this run
                      </span>
                    )}
                  </div>
                </Callout>
              ) : (
                <Callout side="left" at={AT_RATING} title="Rated">
                  <span className={styles.calloutLead}>{card.rating}</span>
                  <span className={styles.calloutNote}>{capitalize(card.tier)} tier</span>
                </Callout>
              )}

              <Callout side="right" at={AT_CLUB} title="Club">
                <span className={styles.calloutLead}>{card.org_name ?? card.org}</span>
                <span className={styles.calloutNote}>{LEAGUE_LABEL[card.league] ?? card.league}</span>
              </Callout>

              <Callout side="left" at={AT_ORIGIN} title="Origin">
                <span className={styles.calloutLead}>{countryName(card.nationality)}</span>
                <span className={styles.calloutNote}>{regionFullName(card.region)}</span>
              </Callout>

              <Callout side="right" at={AT_SPECIALTIES} title="Specialties">
                {specialties.length === 0 ? (
                  <span className={styles.calloutNote}>None active</span>
                ) : specialties.map(spec => (
                  <div key={spec.key} className={styles.specLine}>
                    <span className={styles.specBadgeIcon}><SpecialtyIcon spec={spec.key} size="64%" /></span>
                    <div className={styles.specText}>
                      <b className={styles.specName}>{spec.name}</b>
                      <p className={styles.specDesc}>{spec.desc}</p>
                    </div>
                  </div>
                ))}
              </Callout>
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
            <p className={styles.hint}>click card to flip for the full sheet · esc to close</p>
          </div>
        </m.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// One annotation: a hairline out to a mark on the card, a label, and the
// thing the mark does not say on its own. `at` is where the leader meets
// the card, as a share of its height.
function Callout({ side, at, title, children }) {
  return (
    <div className={styles.callout} data-side={side} style={{ '--at': at }}>
      <span className={styles.leader} aria-hidden="true" />
      <span className={styles.calloutTitle}>{title}</span>
      {children}
    </div>
  );
}
