import useCardTilt from '../lib/useCardTilt';
import { assetPath } from '../lib/utils';
import styles from './SquadBar.module.css';

// The persistent bottom bar shell: the squad dock spans it, the pack control
// sits in its own bottom-right corner, and the phase's own action buttons -
// unchanged, page-owned markup - float centered over the middle of it. Three
// independent anchors rather than a row splitting its width between them, so
// none of the three ever has to fight the others for space.
export default function SquadBar({
  dock,
  packs = null,
  onOpenPack = null,
  packActionLabel = 'Open a pack',
  // Matches SquadDock's own `scale === 'large'` - the pack corner sizes
  // itself off the same card footprint the dock is currently using, on the
  // manage screen where the squad (and its cards) are bigger.
  large = false,
  children,
}) {
  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        <div className={styles.dockSlot} data-squad-dock="true">{dock}</div>
      </div>
      {packs != null && (
        <PackCorner packs={packs} onOpenPack={onOpenPack} packActionLabel={packActionLabel} large={large} />
      )}
      <div className={styles.actions}>{children}</div>
    </div>
  );
}

// Tilts under the pointer the same way a real PlayerCard does (useCardTilt
// is PlayerCard's own hook, used bare here) instead of sitting flat like an
// icon button - this is meant to read as an object on the shelf, not chrome.
function PackCorner({ packs, onOpenPack, packActionLabel, large }) {
  const {
    tiltRef, onPointerMove, onPointerEnter, onPointerDown, onPointerUp, onPointerLeave, onFocus, onBlur,
  } = useCardTilt({ disabled: !onOpenPack });
  const Tag = onOpenPack ? 'button' : 'span';
  return (
    <Tag
      type={onOpenPack ? 'button' : undefined}
      className={styles.packCorner}
      data-large={large ? 'true' : undefined}
      data-empty={packs === 0}
      disabled={onOpenPack ? packs === 0 : undefined}
      onClick={onOpenPack ?? undefined}
      onPointerMove={onPointerMove}
      onPointerEnter={onPointerEnter}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-label={onOpenPack
        ? (packs > 0 ? `${packActionLabel} - ${packs} banked` : 'No packs banked')
        : `${packs} pack${packs === 1 ? '' : 's'} banked`}
    >
      <span ref={tiltRef} className={styles.packTilt}>
        <img className={styles.packThumb} src={assetPath('/assets/brand/gauntlet-icon.webp')} alt="" aria-hidden="true" draggable={false} />
        <span className={styles.packCount} aria-hidden="true">{packs}</span>
      </span>
    </Tag>
  );
}
