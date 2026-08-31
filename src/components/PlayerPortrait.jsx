import kits from '../data/kits.json';
import { assetPath } from '../lib/utils';
import styles from './PlayerPortrait.module.css';

const PLACEHOLDER = '/assets/players/placeholder.png';

// Must match head_scale() in scripts/build_portraits.py. Matching neck widths
// exactly wrecks head size when the two necks differ: measured ratios across
// the real roster run from 0.25 to 1.89, which renders pinheads and giants.
// The kit's neck extension absorbs whatever the clamp leaves unmatched.
const SCALE_MIN = 0.88;
const SCALE_MAX = 1.12;

// Native size of every portrait asset (photo, head and kit plate alike).
const PORTRAIT_W = 400;
const PORTRAIT_H = 412;

/**
 * A card's portrait.
 *
 * The untouched vlr.gg photo is the default and the common case — compositing
 * only happens when the card is wearing someone else's kit, or has no photo of
 * its own to show:
 *
 *   no photo            -> grey head + the kit's jersey
 *   kit === own org     -> raw photo, untouched
 *   kit !== own org     -> player's head + that kit's jersey
 */
export default function PlayerPortrait({
  card,
  kit,
  className = '',
  style,
  loading = 'lazy',
  // Card plane is a fixed 400x412 box; the broadcast/hero bands size faces as
  // a share of their container. Every offset below is expressed as a
  // percentage of the portrait's own box, so the same composite is correct at
  // any width and `fluid` only has to swap the outer box.
  fluid = false,
}) {
  const hasPhoto = Boolean(card.photo) && card.photo !== PLACEHOLDER;
  const kitId = kit ?? card.org;
  const kitGeom = kitId ? kits[kitId] : null;
  const headGeom = card.headGeom;

  const wearingOtherKit = Boolean(kitId) && Boolean(card.org) && kitId !== card.org;

  const composite = !card.noKitSwap
    && card.league !== 'icon'
    && Boolean(card.org)
    && Boolean(card.head)
    && Boolean(headGeom)
    && Boolean(kitGeom)
    && (!hasPhoto || wearingOtherKit);

  if (!composite) {
    if (!hasPhoto) return null;
    return (
      <img
        className={className}
        style={style}
        src={assetPath(card.photo)}
        alt={card.player}
        loading={loading}
        // Intrinsic size matters here: a lazy image with no dimensions collapses
        // to zero height, never intersects the viewport, and so never loads —
        // which blanks every photo card. width/height give it an aspect ratio
        // before the bytes arrive, so lazy loading still works.
        width={PORTRAIT_W}
        height={PORTRAIT_H}
        draggable={false}
      />
    );
  }

  const raw = kitGeom.neckW / Math.max(headGeom.neckW, 1);
  const scale = Math.min(Math.max(raw, SCALE_MIN), SCALE_MAX);
  // Percentages, not pixels: a translate percentage resolves against the
  // element's own box, so these offsets stay correct whether the portrait is
  // rendered at its native 400x412 or scaled down inside a hero band.
  const dx = (kitGeom.neckCx - headGeom.neckCx * scale) / PORTRAIT_W * 100;
  const dy = (kitGeom.neckY - headGeom.neckY * scale) / PORTRAIT_H * 100;
  const transform = `translate(${dx}%, ${dy}%) scale(${scale})`;
  const collarInset = (kitGeom.collarY / PORTRAIT_H) * 100;
  const kitSrc = assetPath(kitGeom.plate);

  return (
    <div
      className={`${fluid ? styles.fluid : styles.portrait} ${className}`}
      style={style}
      role="img"
      aria-label={card.player}
    >
      {/* body + shoulders, behind everything */}
      <img
        className={`${styles.layer} ${styles.kitBack}`}
        src={kitSrc}
        alt=""
        aria-hidden="true"
        loading={loading}
        draggable={false}
      />
      <img
        className={`${styles.layer} ${styles.head}`}
        src={assetPath(card.head)}
        alt=""
        aria-hidden="true"
        loading={loading}
        style={{ transform }}
        draggable={false}
      />
      {/* same decoded image again, clipped to the collar down — drawing it in
          FRONT of the neck is what makes a seam gap structurally impossible */}
      <img
        className={`${styles.layer} ${styles.kitFront}`}
        src={kitSrc}
        alt=""
        aria-hidden="true"
        loading={loading}
        style={{ clipPath: `inset(${collarInset}% 0 0 0)` }}
        draggable={false}
      />
      {card.hair && (
        <img
          className={`${styles.layer} ${styles.hair}`}
          src={assetPath(card.hair)}
          alt=""
          aria-hidden="true"
          loading={loading}
          style={{ transform }}
          draggable={false}
        />
      )}
    </div>
  );
}
