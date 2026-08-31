import { m } from 'motion/react';
import { roleAbbr, cardTextColor, countryName, regionFullName, assetPath } from '../lib/utils';
import useCardTilt from '../lib/useCardTilt';
import { getCardSpecialties } from '../data/specialties';
import { cardSpring, DUR, EASE } from '../lib/motion';
import SpecialtyIcon from './SpecialtyIcon';
import PlayerPortrait from './PlayerPortrait';
import styles from './PlayerCard.module.css';

const CARD_W = 400;
const CARD_H = 580;

const STAT_KEYS   = ['aim', 'positioning', 'ability', 'mentality', 'synergy'];
const STAT_LABELS = { aim: 'AIM', positioning: 'POS', ability: 'ABL', mentality: 'MNT', synergy: 'SYN' };
const STAT_LABELS_FULL = {
  aim: 'Aim', positioning: 'Positioning', ability: 'Ability', mentality: 'Mentality', synergy: 'Synergy',
};

const PLANE = {
  bg:    { '--z': '0px',   '--shift': '0px' },
  photo: { '--z': '22px',  '--shift': '6px' },
  top:   { '--z': '45px',  '--shift': '14px' }, // stat bg, text, logos
  glare: { '--z': '55px',  '--shift': '0px' },
  spec:  { '--z': '64px',  '--shift': '18px' }, // specialty rail, pops forward
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
  boosterIcons = [],
  kit,
  // Opt-in shared-layout id (R2 — spring physics, PlayerCard only; see
  // src/lib/motion.js). Two call sites currently claim a given card's id at
  // once (a dock chip and CardFocusOverlay) — the one-owner rule is the
  // caller's job: whichever mount currently isn't "the" visible instance of
  // that card must pass layoutId={undefined}, or Framer Motion has two
  // elements racing to own the same shared-layout animation.
  layoutId,
}) {
  const textColor  = cardTextColor(card.palette);
  const mutedColor = textColor + 'aa';
  const showEditionTop = card.tier === 'prestige' || card.tier === 'iconic';
  const regionLogo = assetPath(`/assets/regions/${card.region.toLowerCase()}.png`);
  const bgSrc = assetPath(`/assets/card-bg/${card.palette}-bg.png`);
  const specialties = getCardSpecialties(card);
  const specColor = SPEC_COLOR[card.palette] ?? SPEC_COLOR.gold;

  const { tiltRef, onPointerMove, onPointerLeave } = useCardTilt({ disabled: !tilt });

  return (
    <m.div
      layoutId={layoutId}
      // `layout` stays on the spring (the layoutId morph between the dock,
      // overlay, and draft strip); `default` covers whileTap's `scale` — a
      // separate, sharp press-confirm distinct from the continuous pointer
      // tilt in useCardTilt.js, which lives on the nested `.tilt` div below
      // and so never fights this one for the same `transform`.
      transition={{ layout: cardSpring, default: { duration: DUR.micro, ease: EASE.out } }}
      whileTap={onClick ? { scale: 0.97 } : undefined}
      style={{ width: CARD_W * displayScale, height: CARD_H * displayScale, flexShrink: 0 }}
      onClick={onClick}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
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
          style={{
            fontFamily: "'Familjen Grotesk', sans-serif",
            '--spec': specColor,
            boxShadow: selected
              ? `0 0 0 ${Math.round(3 / displayScale)}px #ffffff, 0 0 0 ${Math.round(6 / displayScale)}px rgba(255,255,255,0.4)`
              : undefined,
          }}
        >
          <div className={styles.flip} style={{ '--flip': flipped ? '180deg' : '0deg' }}>

            {/* ── FRONT FACE ── */}
            <div className={`${styles.face} ${styles.faceFront}`}>
              <img className={styles.layerBg} style={PLANE.bg} src={bgSrc} alt="" aria-hidden="true" draggable={false} />

              <PlayerPortrait
                card={card}
                kit={kit}
                className={styles.layerPhoto}
                style={PLANE.photo}
              />

              <img className={styles.layerStatBg} style={PLANE.top} src={assetPath(`/assets/stat-bg/${card.palette}-stat-bg.png`)} alt="" aria-hidden="true" draggable={false} />

              <div className={styles.layerText} style={PLANE.top}>
                <div className={styles.topLeft}>
                  <span style={{ fontSize: 68, fontWeight: 700, color: textColor, lineHeight: 1 }}>
                    {card.rating}
                  </span>
                  <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '0.02em', color: textColor }}>
                    {roleAbbr(card.role)}
                  </span>
                  <span
                    className={`fi fi-${card.nationality.toLowerCase()}`}
                    style={{ width: 46, height: 34, borderRadius: 2 }}
                  />
                </div>

                {showEditionTop && (
                  <div className={styles.topRight}>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textAlign: 'right', maxWidth: 70, color: textColor, lineHeight: 1.3 }}>
                      {card.edition}
                    </span>
                  </div>
                )}

                {/* Specialties rail — cut-corner icon frames down the left
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

              {boosterIcons.length > 0 && (
                <div className={styles.boosterRail} style={{ '--z': '50px', '--shift': '10px' }} aria-label="Player effects">
                  {boosterIcons.map((icon, index) => (
                    <div className={styles.boosterSlot} key={`${icon.key}-${index}`}>
                      <button className={`${styles.boosterChip} ${icon.tone === 'fatigue' ? styles.fatigueChip : styles.boostChip}`} type="button" aria-label={`${icon.label}: ${icon.desc}`}>
                        {icon.glyph}
                      </button>
                      <span className={styles.boosterTooltip}><b>{icon.label}</b>{icon.desc}</span>
                    </div>
                  ))}
                </div>
              )}

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
