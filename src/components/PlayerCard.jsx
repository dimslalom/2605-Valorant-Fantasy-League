import { useState } from 'react';
import { m } from 'motion/react';
import { roleAbbr, cardTextColor, countryName, regionFullName, assetPath } from '../lib/utils';
import useCardTilt from '../lib/useCardTilt';
import { getCardSpecialties } from '../data/specialties';
import { cardSpring, DUR, EASE } from '../lib/motion';
import SpecialtyIcon from './SpecialtyIcon';
import PlayerPortrait from './PlayerPortrait';
import CountryFlag from './CountryFlag';
import { playUiSound } from '../lib/gameAudio';
import styles from './PlayerCard.module.css';
import { STAGE_LABEL } from '../engine/endless/career';
import { STAT_KEYS, STAT_LABELS, STAT_LABELS_FULL } from '../data/statFields';

const CARD_W = 400;
const CARD_H = 580;

const PLANE = {
  bg:    { '--z': '0px',   '--shift': '0px' },
  photo: { '--z': '11px',  '--shift': '6px' },
  top:   { '--z': '22px',  '--shift': '14px' }, // stat bg, text, logos
  glare: { '--z': '27px',  '--shift': '0px' },
  spec:  { '--z': '32px',  '--shift': '18px' }, // specialty rail, pops forward
};

// Specialty chip frame color tracks the card's tier metal.
const SPEC_COLOR = {
  bronze: '#c8843f',
  silver: '#c3cad6',
  gold:   '#d8b34c',
  icon:   '#e6d27a',
};

export default function PlayerCard({
  card,
  selected = false,
  onClick,
  displayScale = 0.5,
  tilt = true,
  flippable = false,
  flipped = false,
  kit,
  portraitLoading = 'lazy',
  portraitFetchPriority = 'auto',
  // Outside a real drop surface, cards can still be picked up and will
  // spring back to their origin. SquadDock and PackRip opt out because their
  // parent wrappers already own purposeful drag gestures.
  canDrag = true,
  // Opt-in shared-layout id (R2 - spring physics, PlayerCard only; see
  // src/lib/motion.js). Two call sites currently claim a given card's id at
  // once (a dock chip and CardFocusOverlay) - the one-owner rule is the
  // caller's job: whichever mount currently isn't "the" visible instance of
  // that card must pass layoutId={undefined}, or Framer Motion has two
  // elements racing to own the same shared-layout animation.
  layoutId,
  // Career signals from the endless engine (cardSignals). Absent everywhere
  // else, so every other surface renders exactly as it did before.
  signals = null,
}) {
  // Latched the first time this card is turned, so the return flip animates
  // while a card that mounts face-up plays nothing - every card in the game
  // mounts unflipped, and they must not all deal themselves a flip-back.
  // Adjusted during render rather than in an effect: React re-runs this
  // component before committing, so the flip and the latch land together.
  const [turned, setTurned] = useState(false);
  if (flipped && !turned) setTurned(true);

  const textColor  = cardTextColor(card.palette);
  const mutedColor = textColor + 'aa';
  const showEditionTop = card.tier === 'prestige' || card.tier === 'iconic';
  const regionLogo = assetPath(`/assets/regions/${card.region.toLowerCase()}.png`);
  const bgSrc = assetPath(`/assets/card-bg/${card.palette}-bg.png`);
  const specialties = getCardSpecialties(card);
  const specColor = SPEC_COLOR[card.palette] ?? SPEC_COLOR.gold;

  const {
    tiltRef,
    onPointerMove,
    onPointerEnter,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onFocus,
    onBlur,
  } = useCardTilt({ disabled: !tilt, seed: card.id });
  const activate = onClick ? () => {
    playUiSound(flippable ? 'flip' : 'select');
    onClick();
  } : undefined;

  return (
    <m.div
      className={styles.cardRoot}
      layoutId={layoutId}
      // `layout` stays on the spring (the layoutId morph between the dock,
      // overlay, and draft strip); `default` covers whileTap's `scale` - a
      // separate, sharp press-confirm distinct from the continuous pointer
      // tilt in useCardTilt.js, which lives on the nested `.tilt` div below
      // and so never fights this one for the same `transform`.
      transition={{ layout: cardSpring, default: { duration: DUR.micro, ease: EASE.out } }}
      whileTap={onClick ? { scale: 0.97 } : undefined}
      drag={canDrag}
      dragConstraints={{ top: 0, right: 0, bottom: 0, left: 0 }}
      dragElastic={0.2}
      dragMomentum={false}
      whileDrag={{ zIndex: 50 }}
      style={{ width: CARD_W * displayScale, height: CARD_H * displayScale, flexShrink: 0 }}
      onClick={activate}
      onPointerMove={onPointerMove}
      onPointerEnter={(event) => { onPointerEnter(event); if (onClick) playUiSound('hover'); }}
      onPointerDown={(event) => { onPointerDown(event); if (onClick) playUiSound('lift'); }}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      } : undefined}
    >
      <div
        className={styles.stage}
        style={{
          width: CARD_W,
          height: CARD_H,
          transform: `scale(${displayScale})`,
          transformOrigin: 'top left',
        }}
      >
        <div
          ref={tiltRef}
          className={[styles.tilt, onClick ? styles.clickable : ''].join(' ')}
          data-palette={card.palette}
          data-tier={card.tier}
          data-flipped={flipped ? 'true' : turned ? 'back' : undefined}
          style={{
            fontFamily: "'Familjen Grotesk', sans-serif",
            '--spec': specColor,
          }}
          data-selected={selected ? 'true' : undefined}
        >
          {/* These silhouettes use the card art's alpha instead of a box
              shadow, so Safari cannot expose a translucent rectangular
              compositor tile around cut-corner/transparent card artwork. */}
          <span
            className={styles.contactShadow}
            style={{ WebkitMaskImage: `url(${bgSrc})`, maskImage: `url(${bgSrc})` }}
            aria-hidden="true"
          />
          <span
            className={styles.ambientShadow}
            style={{ WebkitMaskImage: `url(${bgSrc})`, maskImage: `url(${bgSrc})` }}
            aria-hidden="true"
          />
          {selected && <span className={styles.selectionCorners} aria-hidden="true" />}
          <div
            className={styles.flip}
            data-flipped={flipped ? 'true' : turned ? 'back' : 'false'}
            style={{ '--flip': flipped ? '180deg' : '0deg' }}
          >

            {/* ── FRONT FACE ── */}
            <div className={`${styles.face} ${styles.faceFront}`}>
              <img className={styles.layerBg} style={PLANE.bg} src={bgSrc} alt="" aria-hidden="true" draggable={false} />

              <PlayerPortrait
                card={card}
                kit={kit}
                className={styles.layerPhoto}
                style={PLANE.photo}
                loading={portraitLoading}
                fetchPriority={portraitFetchPriority}
              />

              <img
                className={styles.layerStatBg}
                style={PLANE.top}
                src={assetPath(`/assets/stat-bg/${card.palette}-stat-bg.png`)}
                alt=""
                aria-hidden="true"
                draggable={false}
              />

              <div className={styles.layerText} style={PLANE.top}>
                <div className={styles.topLeft}>
                  <span style={{ fontSize: 68, fontWeight: 700, color: textColor, lineHeight: 1 }}>
                    {card.rating}
                  </span>
                  <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '0.02em', color: textColor }}>
                    {roleAbbr(card.role)}
                  </span>
                  <CountryFlag code={card.nationality} style={{ width: 46, height: 34, borderRadius: 2 }} />
                </div>

                {(showEditionTop || signals) && (
                  <div className={styles.topRight}>
                    {showEditionTop && (
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textAlign: 'right', maxWidth: 70, color: textColor, lineHeight: 1.3 }}>
                        {card.edition}
                      </span>
                    )}
                    {/* Where this player is in their career, and which way
                        they are going. Shown as a chip and a mark, the same
                        register as the role abbreviation and the flag - data
                        on the card, not a sentence somewhere else. */}
                    {signals && (
                      <span className={styles.stageMark} data-stage={signals.stage} style={{ color: textColor }}>
                        {signals.trend !== 0 && (
                          <i
                            className={styles.trend}
                            data-dir={signals.trend > 0 ? 'up' : 'down'}
                            aria-hidden="true"
                          />
                        )}
                        {STAGE_LABEL[signals.stage]}
                      </span>
                    )}
                  </div>
                )}

                {/* Specialties rail - cut-corner icon frames down the left
                    edge, spilling half off the card, floated forward in 3D. */}
                {specialties.length > 0 && (
                  <div className={styles.specialtiesRail} style={{ ...PLANE.spec, '--spec': specColor }} aria-label="Player specialties">
                    {specialties.map(spec => (
                      <div key={spec.key} className={styles.specSlot}>
                        <div className={styles.specCutChip}>
                          <SpecialtyIcon spec={spec.key} />
                        </div>
                        <div className={styles.specTooltip}>
                          <b>{spec.name}</b>
                          <span>{spec.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className={styles.playerName} style={{ color: textColor }}>
                  {card.player}
                </div>

                <div className={styles.statContent}>
                  <div className={styles.statRow}>
                    {STAT_KEYS.map((key) => (
                      <div key={key} className={styles.statItem}>
                        <span style={{ fontSize: 20, fontWeight: 600, color: mutedColor }}>
                          {STAT_LABELS[key]}
                        </span>
                        <span style={{ fontSize: 38, fontWeight: 700, color: textColor }}>
                          {card.stats[key]}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className={styles.logoRow}>
                    {card.org_logo && (
                      <img src={assetPath(card.org_logo)} alt={card.org} style={{ width: 32, height: 32, objectFit: 'contain' }} draggable={false} />
                    )}
                    <img src={regionLogo} alt={card.region} style={{ width: 32, height: 32, objectFit: 'contain' }} draggable={false} />
                  </div>
                </div>
              </div>

              <div
                className={styles.glare}
                style={{ ...PLANE.glare, WebkitMaskImage: `url(${bgSrc})`, maskImage: `url(${bgSrc})` }}
                aria-hidden="true"
              />
            </div>

            {/* ── BACK FACE ── */}
            {flippable && (
              <div className={`${styles.face} ${styles.faceBack}`}>
                <img className={styles.layerBg} src={bgSrc} alt="" aria-hidden="true" draggable={false} />
                <div className={styles.backContent} style={{ color: textColor }}>
                  <div className={styles.backHeader}>
                    <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.25em', color: mutedColor }}>
                      SCOUTING REPORT
                    </span>
                    <span style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>{card.player}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: mutedColor, textAlign: 'center' }}>
                      {card.org_name ?? card.org} · {regionFullName(card.region)} · {card.role}
                    </span>
                  </div>

                  <div className={styles.backStats}>
                    {STAT_KEYS.map((key) => (
                      <div key={key} className={styles.backStatRow}>
                        <span style={{ fontSize: 15, fontWeight: 600, width: 104, color: mutedColor }}>
                          {STAT_LABELS_FULL[key]}
                        </span>
                        <div className={styles.backStatTrack} style={{ background: textColor + '22' }}>
                          <div
                            className={styles.backStatFill}
                            style={{ width: `${card.stats[key]}%`, background: textColor }}
                          />
                        </div>
                        <span style={{ fontSize: 17, fontWeight: 700, width: 34, textAlign: 'right' }}>
                          {card.stats[key]}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className={styles.backMeta}>
                    <BackMetaItem label="Rating" value={card.rating} muted={mutedColor} />
                    <BackMetaItem label="Tier" value={card.tier} muted={mutedColor} />
                    <BackMetaItem label="Nationality" value={countryName(card.nationality)} muted={mutedColor} />
                    <BackMetaItem label="Agents" value={(card.agents ?? []).map(capitalize).join(', ') || 'Unknown'} muted={mutedColor} />
                    <BackMetaItem
                      label="League"
                      value={card.league === 't2' ? 'Challengers' : card.league === 'icon' ? 'Icons' : 'VCT'}
                      muted={mutedColor}
                    />
                  </div>

                  {/* Specialties list on the back face */}
                  {specialties.length > 0 && (
                    <div className={styles.backSpecialties}>
                      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', color: mutedColor }}>SPECIALTIES</span>
                      <div className={styles.specListBack}>
                        {specialties.map(s => (
                          <div key={s.key} className={styles.backSpecRow}>
                            <span className={styles.backSpecIcon}><SpecialtyIcon spec={s.key} size="66%" /></span>
                            <div>
                              <b>{s.name}</b>: {s.short}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </m.div>
  );
}

function BackMetaItem({ label, value, muted }) {
  return (
    <div className={styles.backMetaItem}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', color: muted }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 700, textTransform: 'capitalize' }}>{value}</span>
    </div>
  );
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
