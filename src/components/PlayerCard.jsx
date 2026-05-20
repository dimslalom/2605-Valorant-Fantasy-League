import { roleAbbr, cardTextColor } from '../lib/utils';
import styles from './PlayerCard.module.css';

const CARD_W = 400;
const CARD_H = 580;

const STAT_KEYS   = ['aim', 'positioning', 'ability', 'mentality', 'synergy'];
const STAT_LABELS = { aim: 'AIM', positioning: 'POS', ability: 'ABL', mentality: 'MNT', synergy: 'SYN' };

export default function PlayerCard({ card, selected = false, onClick, displayScale = 0.5 }) {
  const textColor  = cardTextColor(card.palette);
  const mutedColor = textColor + 'aa';
  const showEditionTop = card.tier === 'prestige' || card.tier === 'iconic';
  const regionLogo = `/assets/regions/${card.region.toLowerCase()}.png`;

  return (
    <div
      style={{ width: CARD_W * displayScale, height: CARD_H * displayScale, flexShrink: 0 }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
    >
      <div
        className={[styles.card, onClick ? styles.clickable : ''].join(' ')}
        style={{
          width: CARD_W,
          height: CARD_H,
          transform: `scale(${displayScale})`,
          transformOrigin: 'top left',
          fontFamily: "'Familjen Grotesk', sans-serif",
          boxShadow: selected
            ? `0 0 0 ${Math.round(3 / displayScale)}px #ffffff, 0 0 0 ${Math.round(6 / displayScale)}px rgba(255,255,255,0.4)`
            : undefined,
        }}
      >
        {/* z=0 — card background */}
        <img className={styles.layerBg} src={`/assets/card-bg/${card.palette}-bg.png`} alt="" aria-hidden="true" />

        {/* z=1 — player photo, top-anchored, natural width (hidden when no real photo yet) */}
        {card.photo !== '/assets/players/placeholder.png' && (
          <img className={styles.layerPhoto} src={card.photo} alt={card.player} />
        )}

        {/* z=2 — stat panel bg (full 400×580 PNG, transparent at top) */}
        <img className={styles.layerStatBg} src={`/assets/stat-bg/${card.palette}-stat-bg.png`} alt="" aria-hidden="true" />

        {/* z=3 — text overlay */}
        <div className={styles.layerText}>

          {/* Top-left: rating, role abbr, flag — bigger and lower */}
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

          {/* Player name — anchored just above the stats inside the stat panel */}
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
      </div>
    </div>
  );
}
