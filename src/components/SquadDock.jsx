import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { m, useMotionValue, animate } from 'motion/react';
import PlayerCard from './PlayerCard';
import useMediaQuery from '../lib/useMediaQuery';
import { cardSpring } from '../lib/motion';
import { assetPath } from '../lib/utils';
import styles from './SquadDock.module.css';

const CHIP_SCALE = 0.16;
const CHIP_SCALE_MOBILE = 0.13;
const PREVIEW_SCALE = 0.4;
const DRAG_THRESHOLD = 6; // px of pointer travel before a press counts as a drag, not a tap

// Always-legible squad readout for the bottom bar: small real PlayerCard
// tiles, not a bespoke rating/role chip — the actual card already has a
// correct, non-overlapping layout for this data, so there's no reason to
// re-invent one at a smaller size. No open/close state exists here either —
// every tile is readable at rest, so there's nothing to trigger or lose.
// Hovering lifts a bigger real card above it (mouse only, skipped under
// prefers-reduced-motion since the CSS transition is what reads as "lift");
// clicking a tile opens the single-card focus overlay. The full team
// scoreboard lives one Tab-hold away (see SquadSheet) — the SQUAD button is
// the mouse/touch door into the same place.
export default function SquadDock({
  roster,
  size = 5,
  iglId,
  squadName,
  onFocusCard,
  onOpenSheet,
  // The id of whatever card CardFocusOverlay currently has open, if any.
  // One-owner rule for the shared layoutId morph: while that card's overlay
  // is open, THIS chip must stop claiming `card-${id}` (layoutId={undefined})
  // so only the overlay's copy owns it — two simultaneously mounted elements
  // claiming the same layoutId is undefined behavior in Framer Motion.
  focusCardId = null,
  // Banked pack count — surfaced here so it's always legible, the same way
  // the roster count is, since packs are now a run-spanning currency you
  // choose when to spend rather than a one-off swap offered at a fixed time.
  packs = null,
  // Supplying this makes the pack badge itself the "open a pack" control —
  // the badge IS the button, no separate one elsewhere. Left null on phases
  // where spending a pack wouldn't make sense right now; the badge still
  // renders (as an inert readout) so the count never disappears.
  onOpenPack = null,
  // (idA, idB) => void — supplying this opts every chip into drag-to-swap.
  // Left null for any roster whose order lives server-side (Multiplayer's
  // snapshot), where a local reorder would just get overwritten by the next
  // broadcast.
  onSwap = null,
}) {
  const [hoveredId, setHoveredId] = useState(null);
  // Lifted up (not local to each chip) so that dragging chip A suppresses
  // every OTHER chip's hover preview too, not just A's own — the cursor
  // sweeps across sibling chips en route to the drop target, and each of
  // those firing its own hover popup mid-drag is exactly the clutter this
  // is meant to prevent.
  const [draggingId, setDraggingId] = useState(null);
  const mobile = useMediaQuery('(max-width: 680px)');
  const chipScale = mobile ? CHIP_SCALE_MOBILE : CHIP_SCALE;
  const slots = Array.from({ length: size }, (_, i) => roster[i] ?? null);
  const PackTag = onOpenPack ? 'button' : 'span';

  return (
    <div className={styles.dock}>
      <div className={styles.chips}>
        {slots.map((card, i) => (card ? (
          <DraggableChip
            key={card.id}
            card={card}
            iglId={iglId}
            focusCardId={focusCardId}
            chipScale={chipScale}
            onFocusCard={onFocusCard}
            onSwap={onSwap}
            hoveredId={hoveredId}
            setHoveredId={setHoveredId}
            isDragging={draggingId != null}
            onDragStateChange={(dragging) => setDraggingId(dragging ? card.id : null)}
          />
        ) : (
          <span key={`empty-${i}`} className={styles.chipEmpty} aria-hidden="true" />
        )))}
      </div>

      <div className={styles.meta}>
        <span className={styles.name}>{squadName || 'Your squad'}</span>
        {packs != null && (
          <PackTag
            type={onOpenPack ? 'button' : undefined}
            className={styles.packBadge}
            data-empty={packs === 0}
            disabled={onOpenPack ? packs === 0 : undefined}
            onClick={onOpenPack ?? undefined}
            aria-label={onOpenPack
              ? (packs > 0 ? `Open a pack — ${packs} banked` : 'No packs banked')
              : `${packs} pack${packs === 1 ? '' : 's'} banked`}
          >
            <img className={styles.packThumb} src={assetPath('/assets/brand/gauntlet-icon.webp')} alt="" aria-hidden="true" />
            <span className={styles.packCount} aria-hidden="true">{packs}</span>
          </PackTag>
        )}
        {onOpenSheet && (
          <button type="button" className={styles.squadBtn} onClick={onOpenSheet}>
            Squad
          </button>
        )}
      </div>
    </div>
  );
}

// One dock chip, wired for drag-to-swap with the exact same manual
// pointer-event pattern PackRip's draft cards use (see DraggableDraftCard
// there) — deliberately NOT Framer Motion's own `drag` prop. Two real,
// confirmed problems with FM's built-in gesture here: its onDragEnd fires a
// frame late (internal `frame.postRender`), by which point `whileDrag`'s
// `pointerEvents: 'none'` has already reverted (that happens synchronously,
// on gesture end), so a hit-test in onDragEnd keeps hitting the dragged
// chip's own now-solid node instead of whatever's underneath it. And
// separately: a real drag-to-swap reorders `picks` without unmounting the
// dragged chip's DOM node (same key, same element — it just slides to a new
// slot via layoutId), so the browser's trailing native `click` event (which
// always fires after pointerup on whatever element received the original
// pointerdown, regardless of how far the pointer travelled) still lands and
// reopens the card focus overlay right after the swap, masking it. A manual
// drag sidesteps both: the hit-test runs synchronously on pointerup (no
// frame gap to fall out of sync in), and `draggedRef` explicitly swallows
// the one trailing click a real drag produces.
function DraggableChip({
  card, iglId, focusCardId, chipScale, onFocusCard, onSwap, hoveredId, setHoveredId, isDragging, onDragStateChange,
}) {
  const nodeRef = useRef(null);
  const dragRef = useRef(null); // { startX, startY, rect, moved }
  const draggedRef = useRef(false); // true only for the one click right after a real drag
  const [ghostRect, setGhostRect] = useState(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  function targetChip(clientX, clientY) {
    return document.elementFromPoint(clientX, clientY)?.closest('[data-chip-slot]');
  }

  function setDockHighlight(el) {
    document.querySelectorAll('[data-chip-slot][data-drop-active]').forEach((node) => {
      if (node !== el) delete node.dataset.dropActive;
    });
    if (el && el.dataset.cardId !== String(card.id)) el.dataset.dropActive = 'true';
  }

  function cleanupListeners() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }

  function onPointerDown(e) {
    if (!onSwap) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rect = nodeRef.current.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, rect, moved: false };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function onPointerMove(e) {
    const s = dragRef.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      s.moved = true;
      draggedRef.current = true;
      if (nodeRef.current) nodeRef.current.style.touchAction = 'none';
      setGhostRect(s.rect);
      onDragStateChange(true);
    }
    e.preventDefault();
    x.set(dx);
    y.set(dy);
    setDockHighlight(targetChip(e.clientX, e.clientY));
  }

  function onPointerUp(e) {
    const s = dragRef.current;
    cleanupListeners();
    dragRef.current = null;
    if (nodeRef.current) nodeRef.current.style.touchAction = '';
    setDockHighlight(null);
    if (!s?.moved) return; // a plain tap — the chip's own onClick already fired
    onDragStateChange(false);
    const target = targetChip(e.clientX, e.clientY);
    const targetId = target?.dataset.cardId;
    setGhostRect(null);
    x.set(0);
    y.set(0);
    if (targetId && targetId !== String(card.id)) onSwap(card.id, targetId);
  }

  function onPointerCancel() {
    const s = dragRef.current;
    cleanupListeners();
    dragRef.current = null;
    if (nodeRef.current) nodeRef.current.style.touchAction = '';
    setDockHighlight(null);
    if (!s?.moved) return;
    onDragStateChange(false);
    animate(x, 0, { ...cardSpring, onComplete: () => setGhostRect(null) });
    animate(y, 0, cardSpring);
  }

  function onClick() {
    if (draggedRef.current) { draggedRef.current = false; return; }
    onFocusCard(card);
  }

  // Mount-only cleanup for the rare case this unmounts mid-drag (e.g. the
  // phase changes away entirely) without a pointerup/pointercancel ever
  // reaching window — cleanupListeners is redefined every render like every
  // other handler here, so there's nothing stale for the empty dep array to
  // miss.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => cleanupListeners(), []);

  return (
    <span
      ref={nodeRef}
      className={styles.chip}
      data-chip-slot
      data-card-id={card.id}
      data-igl={card.id === iglId ? 'true' : undefined}
      style={{ opacity: ghostRect ? 0 : 1 }}
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHoveredId(card.id)}
      onMouseLeave={() => setHoveredId((id) => (id === card.id ? null : id))}
      onFocus={() => setHoveredId(card.id)}
      onBlur={() => setHoveredId((id) => (id === card.id ? null : id))}
    >
      <PlayerCard
        card={card}
        layoutId={focusCardId === card.id ? undefined : `card-${card.id}`}
        boosterIcons={card.runFx ?? []}
        displayScale={chipScale}
        tilt={false}
        onClick={onClick}
      />

      {hoveredId === card.id && !isDragging && (
        <span className={styles.chipPreview} aria-hidden="true">
          <PlayerCard card={card} boosterIcons={card.runFx ?? []} displayScale={PREVIEW_SCALE} tilt={false} />
        </span>
      )}

      {ghostRect && createPortal(
        <m.div
          className={styles.dragGhost}
          style={{
            position: 'fixed',
            left: ghostRect.left,
            top: ghostRect.top,
            width: ghostRect.width,
            height: ghostRect.height,
            x,
            y,
            scale: 1.3,
          }}
        >
          <PlayerCard card={card} boosterIcons={card.runFx ?? []} displayScale={CHIP_SCALE} tilt={false} />
        </m.div>,
        document.body,
      )}
    </span>
  );
}
