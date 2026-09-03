import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { m, AnimatePresence, useMotionValue, animate } from 'motion/react';
import PlayerCard from './PlayerCard';
import useMediaQuery from '../lib/useMediaQuery';
import useCardTilt from '../lib/useCardTilt';
import { cardSpring, cardLeave } from '../lib/motion';
import { assetPath } from '../lib/utils';
import { playUiSound } from '../lib/gameAudio';
import { prefersReducedMotion } from '../lib/useReducedMotion';
import styles from './SquadDock.module.css';

// The dock is the squad's home across the whole loop, so the cards are read
// at a glance rather than squinted at. `large` is the between-tournaments
// size, where the squad is the subject of the screen rather than reference
// alongside a bracket.
const CHIP_SCALE = 0.20;
const CHIP_SCALE_MOBILE = 0.16;
const CHIP_SCALE_LARGE = 0.26;
const CHIP_SCALE_LARGE_MOBILE = 0.19;
const PREVIEW_SCALE = 0.4;
const DRAG_THRESHOLD = 6; // px of pointer travel before a press counts as a drag, not a tap

// Always-legible squad readout for the bottom bar: small real PlayerCard
// tiles, not a bespoke rating/role chip - the actual card already has a
// correct, non-overlapping layout for this data, so there's no reason to
// re-invent one at a smaller size. No open/close state exists here either -
// every tile is readable at rest, so there's nothing to trigger or lose.
// Hovering lifts a bigger real card above it (mouse only, skipped under
// prefers-reduced-motion since the CSS transition is what reads as "lift");
// clicking a tile opens the single-card focus overlay. The full team
// scoreboard lives one Tab-hold away (see SquadSheet) - the SQUAD button is
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
  // so only the overlay's copy owns it - two simultaneously mounted elements
  // claiming the same layoutId is undefined behavior in Framer Motion.
  focusCardId = null,
  // (idA, idB) => void - supplying this opts every chip into drag-to-swap.
  // Left null for any roster whose order lives server-side (Multiplayer's
  // snapshot), where a local reorder would just get overwritten by the next
  // broadcast.
  onSwap = null,
  // How many of the leading chips are actually starting. Anyone past this is
  // rested: still on the squad, not on the server. Defaults to the whole
  // roster so every non-endless caller is unaffected.
  starterCount = null,
  // Index of a slot that has just been unlocked. It arrives animated and
  // marked, so "you have a new slot" is a thing you SEE rather than a
  // sentence somewhere else on the screen.
  newSlotIndex = null,
  // { index, token } fired once per release/poach acceptance. `token`
  // changes every time (even for the same index) so the effect below
  // re-triggers even when the same trailing slot empties out twice in a
  // row. Drives the departing card's exit animation and a few seconds of
  // highlight on the slot it leaves behind - see the effect below.
  releaseSignal = null,
  // Per-card development, so the hover preview can show load without a
  // second surface. Read only on hover (see chipPreview below) - the
  // resting dock stays clean, nothing about a card's condition is shown
  // until you're actually looking at it.
  dev = null,
  locked = false,
  activeIds = null,
  // 'large' on the manage screen, where the squad is the subject. Named
  // `scale`, not `size` - `size` already means the slot COUNT here.
  scale = 'normal',
}) {
  const [hoveredId, setHoveredId] = useState(null);
  // Lifted up (not local to each chip) so that dragging chip A suppresses
  // every OTHER chip's hover preview too, not just A's own - the cursor
  // sweeps across sibling chips en route to the drop target, and each of
  // those firing its own hover popup mid-drag is exactly the clutter this
  // is meant to prevent.
  const [draggingId, setDraggingId] = useState(null);
  const [stampedIglId, setStampedIglId] = useState(null);
  const previousIglRef = useRef(iglId);
  const [alertSlot, setAlertSlot] = useState(null);
  const previousReleaseTokenRef = useRef(releaseSignal?.token);
  const mobile = useMediaQuery('(max-width: 680px)');
  const large = scale === 'large';
  const chipScale = large
    ? (mobile ? CHIP_SCALE_LARGE_MOBILE : CHIP_SCALE_LARGE)
    : (mobile ? CHIP_SCALE_MOBILE : CHIP_SCALE);
  const slots = Array.from({ length: size }, (_, i) => roster[i] ?? null);

  // A fanned hand, Balatro-style, instead of a row that wraps once it runs
  // out of width: every slot after the first overlaps the one before it, so
  // the whole roster always reads as ONE line regardless of chip size or
  // slot count - wider chips and bigger rosters just push the overlap ratio
  // up, they never wrap to a second row. The exposed sliver of a covered
  // chip stays hoverable/clickable/draggable on its own; hovering (or
  // dragging) lifts a chip clear of its neighbours via --chip-lift below.
  const chipWidth = 400 * chipScale;
  const chipHeight = 580 * chipScale;
  const overlapRatio = size <= 5 ? 0.22 : size === 6 ? 0.34 : size === 7 ? 0.44 : 0.52;
  const chipOverlap = chipWidth * overlapRatio;
  const chipLift = chipHeight * 0.16;

  useEffect(() => {
    if (!iglId || previousIglRef.current === iglId) return undefined;
    previousIglRef.current = iglId;
    setStampedIglId(iglId);
    playUiSound('igl');
    const timer = setTimeout(() => setStampedIglId(null), 480);
    return () => clearTimeout(timer);
  }, [iglId]);

  useEffect(() => {
    if (releaseSignal == null || previousReleaseTokenRef.current === releaseSignal.token) return undefined;
    previousReleaseTokenRef.current = releaseSignal.token;
    setAlertSlot(releaseSignal.index);
    const timer = setTimeout(() => setAlertSlot(null), 2400);
    return () => clearTimeout(timer);
  }, [releaseSignal]);

  return (
    <div className={styles.dock} data-size={large ? 'large' : undefined} data-locked={locked ? 'true' : undefined}>
      <div
        className={styles.chips}
        style={{ '--chip-overlap': `${chipOverlap}px`, '--chip-lift': `${chipLift}px` }}
      >
        <AnimatePresence mode="popLayout">
          {slots.map((card, i) => (card ? (
            <DraggableChip
              key={card.id}
              card={card}
              iglId={iglId}
              stamped={stampedIglId === card.id}
              benched={starterCount != null && i >= starterCount}
              focusCardId={focusCardId}
              chipScale={chipScale}
              onFocusCard={onFocusCard}
              onSwap={onSwap}
              hoveredId={hoveredId}
              setHoveredId={setHoveredId}
              isDragging={draggingId != null}
              onDragStateChange={(dragging) => setDraggingId(dragging ? card.id : null)}
              load={dev?.[card.id]?.f ?? 0}
              active={activeIds?.includes(card.id)}
            />
          ) : (
            <EmptyChip
              key={`empty-${i}`}
              chipScale={chipScale}
              isNew={i === newSlotIndex}
              isAlert={i === alertSlot}
            />
          )))}
        </AnimatePresence>
      </div>

      <div className={styles.meta}>
        <span className={styles.name}>{squadName || 'Your squad'}</span>
        {onOpenSheet && (
          <button type="button" className={styles.squadBtn} onClick={onOpenSheet}>
            Squad
          </button>
        )}
      </div>
    </div>
  );
}

// An open slot, drawn from the same empty-card art everywhere it appears -
// sized to the exact same footprint a real chip would use (400x580 native,
// same as PlayerCard), and given the identical pointer-driven tilt
// (useCardTilt, PlayerCard's own hook, bare here) so it reads as a real
// object sitting in the row rather than a flat placeholder. No click/drag:
// this slot has nothing in it yet.
function EmptyChip({ chipScale, isNew, isAlert }) {
  const {
    tiltRef, onPointerMove, onPointerEnter, onPointerDown, onPointerUp, onPointerLeave,
  } = useCardTilt({});
  return (
    <span
      className={styles.chipEmpty}
      data-new={isNew ? 'true' : undefined}
      data-alert={isAlert ? 'true' : undefined}
      aria-hidden="true"
      style={{ width: `${400 * chipScale}px`, height: `${580 * chipScale}px` }}
      onPointerMove={onPointerMove}
      onPointerEnter={onPointerEnter}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      <span ref={tiltRef} className={styles.chipEmptyTilt}>
        <img className={styles.chipEmptyArt} src={assetPath('/assets/card-bg/empty-card.png')} alt="" draggable={false} />
      </span>
    </span>
  );
}

// One dock chip, wired for drag-to-swap with the exact same manual
// pointer-event pattern PackRip's draft cards use (see DraggableDraftCard
// there) - deliberately NOT Framer Motion's own `drag` prop. Two real,
// confirmed problems with FM's built-in gesture here: its onDragEnd fires a
// frame late (internal `frame.postRender`), by which point `whileDrag`'s
// `pointerEvents: 'none'` has already reverted (that happens synchronously,
// on gesture end), so a hit-test in onDragEnd keeps hitting the dragged
// chip's own now-solid node instead of whatever's underneath it. And
// separately: a real drag-to-swap reorders `picks` without unmounting the
// dragged chip's DOM node (same key, same element - it just slides to a new
// slot via layoutId), so the browser's trailing native `click` event (which
// always fires after pointerup on whatever element received the original
// pointerdown, regardless of how far the pointer travelled) still lands and
// reopens the card focus overlay right after the swap, masking it. A manual
// drag sidesteps both: the hit-test runs synchronously on pointerup (no
// frame gap to fall out of sync in), and `draggedRef` explicitly swallows
// the one trailing click a real drag produces.
function DraggableChip({
  card, iglId, stamped, benched, focusCardId, chipScale, onFocusCard, onSwap, hoveredId, setHoveredId, isDragging, onDragStateChange, load = 0, active = false,
}) {
  const nodeRef = useRef(null);
  const dragRef = useRef(null); // { startX, startY, rect, moved }
  const draggedRef = useRef(false); // true only for the one click right after a real drag
  const [ghostRect, setGhostRect] = useState(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useMotionValue(0);
  const returnAnimationsRef = useRef([]);

  function stopReturnAnimations() {
    returnAnimationsRef.current.forEach(control => control.stop());
    returnAnimationsRef.current = [];
  }

  function springBack() {
    stopReturnAnimations();
    returnAnimationsRef.current = [
      animate(x, 0, { ...cardSpring, onComplete: () => setGhostRect(null) }),
      animate(y, 0, cardSpring),
      animate(rotate, 0, cardSpring),
    ];
  }

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
    stopReturnAnimations();
    const rect = nodeRef.current.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastAt: e.timeStamp, rect, moved: false };
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
    const elapsed = Math.max(1, e.timeStamp - s.lastAt);
    const velocityX = (e.clientX - s.lastX) / elapsed;
    rotate.set(prefersReducedMotion() ? 0 : Math.max(-12, Math.min(12, -velocityX * 8)));
    s.lastX = e.clientX;
    s.lastAt = e.timeStamp;
    setDockHighlight(targetChip(e.clientX, e.clientY));
  }

  function onPointerUp(e) {
    const s = dragRef.current;
    cleanupListeners();
    dragRef.current = null;
    if (nodeRef.current) nodeRef.current.style.touchAction = '';
    setDockHighlight(null);
    if (!s?.moved) return; // a plain tap - the chip's own onClick already fired
    onDragStateChange(false);
    const target = targetChip(e.clientX, e.clientY);
    const targetId = target?.dataset.cardId;
    setGhostRect(null);
    x.set(0);
    y.set(0);
    rotate.set(0);
    if (targetId && targetId !== String(card.id)) onSwap(card.id, targetId);
    if (targetId && targetId !== String(card.id)) playUiSound('drop');
  }

  function onPointerCancel() {
    const s = dragRef.current;
    cleanupListeners();
    dragRef.current = null;
    if (nodeRef.current) nodeRef.current.style.touchAction = '';
    setDockHighlight(null);
    if (!s?.moved) return;
    onDragStateChange(false);
    springBack();
  }

  function onClick() {
    if (draggedRef.current) { draggedRef.current = false; return; }
    onFocusCard?.(card);
  }

  // Mount-only cleanup for the rare case this unmounts mid-drag (e.g. the
  // phase changes away entirely) without a pointerup/pointercancel ever
  // reaching window - cleanupListeners is redefined every render like every
  // other handler here, so there's nothing stale for the empty dep array to
  // miss.
  useEffect(() => () => {
    cleanupListeners();
    stopReturnAnimations();
    setDockHighlight(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <m.span
      ref={nodeRef}
      layout
      transition={{ layout: cardSpring }}
      exit={cardLeave.exit}
      className={styles.chip}
      data-chip-slot
      data-card-id={card.id}
      data-igl={card.id === iglId ? 'true' : undefined}
      data-igl-stamp={stamped ? 'true' : undefined}
      data-benched={benched ? 'true' : undefined}
      data-card-active={active ? 'true' : undefined}
      data-fatigued={load > 60 ? 'true' : undefined}
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
        displayScale={chipScale}
        onClick={onFocusCard ? onClick : undefined}
        canDrag={!onSwap}
      />

      <svg className={styles.chipOutline} viewBox="0 0 400 580" preserveAspectRatio="none" aria-hidden="true">
        <path d="M2 41L200 2L398 41V539L200 578L2 539Z" />
      </svg>

      {hoveredId === card.id && !isDragging && (
        <span className={styles.chipPreview} aria-hidden="true">
          <PlayerCard card={card} displayScale={PREVIEW_SCALE} tilt={false} canDrag={false} />
          {/* Load, surfaced only here - the resting dock stays clean, and
              this is already the moment you're inspecting the player, not a
              permanent overlay on the card art itself. */}
          {load > 0 && (
            <span className={styles.previewLoad} data-high={load > 60 ? 'true' : undefined}>
              <span className={styles.previewLoadLabel}>Load</span>
              <span className={styles.previewLoadTrack}>
                <span className={styles.previewLoadFill} style={{ width: `${Math.min(100, load)}%` }} />
              </span>
              <span className={styles.previewLoadValue}>{load}%</span>
            </span>
          )}
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
            scale: 1.1,
            rotate,
          }}
        >
          <PlayerCard card={card} displayScale={CHIP_SCALE} tilt={false} canDrag={false} />
        </m.div>,
        document.body,
      )}
    </m.span>
  );
}
