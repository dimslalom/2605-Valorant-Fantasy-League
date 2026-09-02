import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { m, AnimatePresence } from 'motion/react';
import PlayerCard from './PlayerCard';
import CountryFlag from './CountryFlag';
import { getCardSpecialties } from '../data/specialties';
import { STAT_KEYS, STAT_LABELS_FULL } from '../data/statFields';
import SpecialtyIcon from './SpecialtyIcon';
import { fadeIn } from '../lib/motion';
import { countryName, regionFullName } from '../lib/utils';
import useDialogFocusTrap from '../lib/useDialogFocusTrap';
import styles from './CardFocusOverlay.module.css';
import { STAGE_LABEL } from '../engine/endless/career';

const LEAGUE_LABEL = { t2: 'Challengers', icon: 'Icons', vct: 'VCT' };

const CARD_H = 580;

// `action` (optional) is the caller's per-card action - { label, disabled },
// fired through `onAction` - rendered as a primary button so the player commits
// to it while looking at the whole card instead of tapping a thumbnail blind.
// Ratings live in a narrow band; anchoring the bar at 50 makes a 3-point
// difference visible instead of a rounding error on a 0-100 track.
const RATING_FLOOR = 50;
const RATING_TOP = 99;
const pct = rating => ((rating - RATING_FLOOR) / (RATING_TOP - RATING_FLOOR)) * 100;
const capitalize = str => str.charAt(0).toUpperCase() + str.slice(1);

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

  // Capped well under native size - this is a details page with a card on
  // it, not a full-screen card. 0.68 tops out around 394px tall; the vh
  // factor still shrinks it further on short viewports.
  const scale = card ? Math.min(0.68, (window.innerHeight * 0.6) / CARD_H) : 0;
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

          <div className={styles.focusContainer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.cardColumn}>
              <PlayerCard
                card={card}
                layoutId={releasingId === card.id ? undefined : `card-${card.id}`}
                displayScale={scale}
                flippable
                flipped={flipped}
                onClick={() => setFlipped((f) => !f)}
              />
            </div>

            {/* The detail panel: everything the card itself only implies -
                full stat values instead of glanceable bars, the org/league/
                nationality profile normally only on the flip side, career
                headroom, and specialties - read top to bottom instead of
                requiring a flip or a squint at the card art. */}
            <div className={styles.detailPanel}>
              <div className={styles.detailHead}>
                <span className={styles.detailRating}>{card.rating}</span>
                <div className={styles.detailHeadText}>
                  <span className={styles.detailName}>{card.player}</span>
                  <span className={styles.detailSub}>
                    {card.org_name ?? card.org} · {card.role}
                  </span>
                </div>
                <CountryFlag code={card.nationality} style={{ width: 30, height: 22 }} />
              </div>

              {/* Career panel - the numbers behind a player's future, shown
                  rather than described. Age and current rating are stated;
                  headroom is the unfilled part of the bar, so "room to grow"
                  is literally visible space instead of a sentence about it. */}
              {signals && (
                <div className={styles.detailSection}>
                  <span className={styles.sectionTitle}>Career</span>
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
                </div>
              )}

              {/* Full stat readout - the same five values the card itself
                  shows, but as bars with their numbers, not a glance. */}
              <div className={styles.detailSection}>
                <span className={styles.sectionTitle}>Performance</span>
                <div className={styles.statList}>
                  {STAT_KEYS.map(key => (
                    <div key={key} className={styles.statRow}>
                      <span className={styles.statLabel}>{STAT_LABELS_FULL[key]}</span>
                      <div className={styles.statTrack}>
                        <div className={styles.statFill} style={{ width: `${card.stats[key]}%` }} />
                      </div>
                      <span className={styles.statValue}>{card.stats[key]}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Profile - the meta that lived only on the flip side before:
                  tier, nationality, league, agents. */}
              <div className={styles.detailSection}>
                <span className={styles.sectionTitle}>Profile</span>
                <div className={styles.metaGrid}>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Tier</span>
                    <span className={styles.metaValue}>{card.tier}</span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Nationality</span>
                    <span className={styles.metaValue}>{countryName(card.nationality)}</span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Region</span>
                    <span className={styles.metaValue}>{regionFullName(card.region)}</span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>League</span>
                    <span className={styles.metaValue}>{LEAGUE_LABEL[card.league] ?? card.league}</span>
                  </div>
                  <div className={`${styles.metaItem} ${styles.metaItemWide}`}>
                    <span className={styles.metaLabel}>Agents</span>
                    <span className={styles.metaValue}>{(card.agents ?? []).map(capitalize).join(', ') || 'Unknown'}</span>
                  </div>
                </div>
              </div>

              {/* Specialties */}
              <div className={styles.detailSection}>
                <span className={styles.sectionTitle}>Specialties</span>
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
