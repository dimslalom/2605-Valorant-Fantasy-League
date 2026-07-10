import { roleAbbr, cardTextColor } from '../lib/utils';
import useCardTilt from '../lib/useCardTilt';
import styles from './PlayerCard.module.css';

const CARD_W = 400;
const CARD_H = 580;

const STAT_KEYS   = ['aim', 'positioning', 'ability', 'mentality', 'synergy'];
const STAT_LABELS = { aim: 'AIM', positioning: 'POS', ability: 'ABL', mentality: 'MNT', synergy: 'SYN' };

// Parallax planes. Each layer sets `--z` (3D depth) and `--shift` (max lateral
// drift in px, multiplied by the pointer fraction −0.5..0.5). Three planes:
// background (static) → photo (mid) → everything else (top). Any layer added
// by future card types joins the effect by declaring these two vars.
const PLANE = {
  bg:    { '--z': '0px',   '--shift': '0px'  },
  photo: { '--z': '45px',  '--shift': '14px' },
  top:   { '--z': '90px',  '--shift': '30px' }, // stat bg, text, logos
  glare: { '--z': '110px', '--shift': '0px'  },
};

export default function PlayerCard({
  card,
  selected = false,
  onClick,
  displayScale = 0.5,
  tilt = true,
  flippable = false,
  flipped = false,
}) {
  const textColor  = cardTextColor(card.palette);
  const mutedColor = textColor + 'aa';
  const showEditionTop = card.tier === 'prestige' || card.tier === 'iconic';
  const regionLogo = `/assets/regions/${card.region.toLowerCase()}.png`;
  const bgSrc = `/assets/card-bg/${card.palette}-bg.png`;

  const { tiltRef, onPointerMove, onPointerLeave } = useCardTilt({ disabled: !tilt });

  return (
    <div
      style={{ width: CARD_W * displayScale, height: CARD_H * displayScale, flexShrink: 0 }}
      onClick={onClick}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      {/* 3D stage: perspective + downscale live together so the whole scene scales uniformly */}
      <div
        className={styles.stage}
        style={{
          width: CARD_W,
          height: CARD_H,
          transform: `scale(${displayScale})`,
          transformOrigin: 'top left',
        }}
      >
        {/* Pointer-driven tilt (CSS vars set by useCardTilt) */}
        <div
          ref={tiltRef}
          className={[styles.tilt, onClick ? styles.clickable : ''].join(' ')}
          style={{
            fontFamily: "'Familjen Grotesk', sans-serif",
            boxShadow: selected
              ? `0 0 0 ${Math.round(3 / displayScale)}px #ffffff, 0 0 0 ${Math.round(6 / displayScale)}px rgba(255,255,255,0.4)`
              : undefined,
          }}
        >
          {/* Flip rotation (separate element so flip and tilt can have different transitions) */}
          <div className={styles.flip} style={{ '--flip': flipped ? '180deg' : '0deg' }}>

            {/* ── FRONT FACE ── */}
            <div className={`${styles.face} ${styles.faceFront}`}>
              {/* plane 1 — card background (static) */}
              <img className={styles.layerBg} style={PLANE.bg} src={bgSrc} alt="" aria-hidden="true" />

              {/* plane 2 — player photo (hidden when no real photo yet) */}
              {card.photo !== '/assets/players/placeholder.png' && (
                <img className={styles.layerPhoto} style={PLANE.photo} src={card.photo} alt={card.player} />
              )}

              {/* plane 3 — stat panel bg (full 400×580 PNG, transparent at top) */}
              <img className={styles.layerStatBg} style={PLANE.top} src={`/assets/stat-bg/${card.palette}-stat-bg.png`} alt="" aria-hidden="true" />

              {/* plane 3 — text overlay */}
              <div className={styles.layerText} style={PLANE.top}>

                {/* Top-left: rating, role abbr, flag */}
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

                {/* Top-right: edition text only for prestige/iconic */}
                {showEditionTop && (
                  <div className={styles.topRight}>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textAlign: 'right', maxWidth: 70, color: textColor, lineHeight: 1.3 }}>
                      {card.edition}
                    </span>
                  </div>
                )}

                {/* Player name */}
                <div className={styles.playerName} style={{ color: textColor }}>
                  {card.player}
                </div>

                {/* Stat panel: stats + logos */}
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
                    <img src={card.org_logo} alt={card.org} style={{ width: 32, height: 32, objectFit: 'contain' }} />
                    <img src={regionLogo} alt={card.region} style={{ width: 32, height: 32, objectFit: 'contain' }} />
                  </div>
                </div>

              </div>

              {/* Glare — masked by the card-bg PNG so it never spills outside the card silhouette */}
              <div
                className={styles.glare}
                style={{ ...PLANE.glare, WebkitMaskImage: `url(${bgSrc})`, maskImage: `url(${bgSrc})` }}
                aria-hidden="true"
              />
            </div>

            {/* ── BACK FACE (only rendered when flippable — grid cards stay lean) ── */}
            {flippable && (
              <div className={`${styles.face} ${styles.faceBack}`}>
                <img className={styles.layerBg} src={bgSrc} alt="" aria-hidden="true" />
                <div className={styles.backContent} style={{ color: textColor }}>
                  <div className={styles.backHeader}>
                    <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.25em', color: mutedColor }}>
                      SCOUTING REPORT
                    </span>
                    <span style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>{card.player}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: mutedColor }}>
                      {card.org} · {card.region} · {roleAbbr(card.role)}
                    </span>
                  </div>

                  <div className={styles.backStats}>
                    {STAT_KEYS.map((key) => (
                      <div key={key} className={styles.backStatRow}>
                        <span style={{ fontSize: 15, fontWeight: 600, width: 52, color: mutedColor }}>
                          {STAT_LABELS[key]}
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
                    <BackMetaItem label="RATING" value={card.rating} muted={mutedColor} />
                    <BackMetaItem label="TIER" value={card.tier} muted={mutedColor} />
                    <BackMetaItem label="NATION" value={card.nationality} muted={mutedColor} />
                    <BackMetaItem label="AGENTS" value={(card.agents ?? []).join(', ') || '—'} muted={mutedColor} />
                  </div>

                  <div className={styles.backPlaceholder} style={{ borderColor: textColor + '44', color: mutedColor }}>
                    RECENT FORM · COMING SOON
                  </div>
                  <div className={styles.backPlaceholder} style={{ borderColor: textColor + '44', color: mutedColor }}>
                    POWERS & ABILITIES · COMING SOON
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

function BackMetaItem({ label, value, muted }) {
  return (
    <div className={styles.backMetaItem}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', color: muted }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 700, textTransform: 'capitalize' }}>{value}</span>
    </div>
  );
}
