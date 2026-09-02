import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { m, useMotionValue, animate } from 'motion/react';
import PlayerCard from './PlayerCard';
import CardReveal from './CardReveal';
import PackTear from './PackTear';
import CountryFlag from './CountryFlag';
import { cardSpring } from '../lib/motion';
import useReducedMotion, { prefersReducedMotion } from '../lib/useReducedMotion';
import { playUiSound } from '../lib/gameAudio';
import useScrollLean from '../lib/useScrollLean';
import styles from './PackRip.module.css';

const DRAG_THRESHOLD = 6; // px of pointer travel before a press counts as a drag, not a tap

// One pack-rip lane, shared by Gauntlet's draft/pack screens and
// Multiplayer's draft/consolation screens - previously duplicated near-
// verbatim (same shake/tear keyframes, same reduced-motion branch) in each
// page. Card reveal goes through CardReveal (tier-scaled entrance); the
// pack's own opening moment is PackTear (drag-to-tear 3D foil peel) - the
// one physical unboxing gesture every mode shares, not a per-mode flourish.
//
// `ripId` is the roll's identity (bump a counter, or key on the choice set) -
// changing it re-triggers the tear. `nation` is the ISO2 code for a national
// pack, or null for a plain random pack; PackTear itself carries no
// nation/title art - that context already lives in the header row above.
export default function PackRip({
  ripId,
  nation,
  packTitle,
  choices,
  interactive,
  onPick,
  selectedId,
  displayScale = 0.5,
  // Scales the closed pack (PackTear) and the strip's own height alongside
  // it - 1 everywhere except a caller staging a bigger unboxing moment (see
  // `--pack-scale` in PackRip/PackTear's CSS).
  packScale = 1,
  headerLabel,
  headerSlot,
  className,
  // 'dock' (default): drop anywhere on the squad dock to pick - the normal
  // draft/pack-open pick. 'chip': the drop must land on a specific dock chip
  // - `onPick` then receives `(card, targetCardId)` instead of just `(card)`
  // - used for the post-run pack swap, where dropping ON a roster member IS
  // the act of choosing who that pack card replaces.
  dropTarget = 'dock',
  // false disables plain-tap picking entirely, leaving drag as the only way
  // in - the swap flow's card is a stand-in for "which roster slot does this
  // replace," a decision real enough that a blind tap shouldn't make it.
  clickable = true,
}) {
  const [ripping, setRipping] = useState(false);
  const stripRef = useRef(null);
  const reducedMotion = useReducedMotion();
  // Same scroll-into-inertia lean as the transfer market's shelf - scroll
  // the pack row and the cards swing with it, then spring back flat.
  useScrollLean(stripRef);

  useEffect(() => {
    if (!ripId) return undefined;
    const startTimer = setTimeout(() => {
      setRipping(!reducedMotion);
      if (stripRef.current) stripRef.current.scrollLeft = 0;
    }, 0);
    return () => clearTimeout(startTimer);
  }, [ripId, reducedMotion]);

  const onWheel = (e) => {
    if (stripRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      stripRef.current.scrollLeft += e.deltaY;
    }
  };

  return (
    <div className={[styles.lane, className].filter(Boolean).join(' ')}>
      <div className={styles.draftBar}>
        <div>
          {headerLabel && <span className={styles.laneLabel}>{headerLabel}</span>}
          {headerSlot && <span className={styles.draftSlot}>{headerSlot}</span>}
          {packTitle && (
            <span className={styles.draftNat}>
              {nation && <CountryFlag code={nation} style={{ width: 34, height: 24 }} />}
              {packTitle}
              <small className={styles.draftCount}>{choices.length} available</small>
            </span>
          )}
        </div>
      </div>

      <div className={styles.strip} ref={stripRef} onWheel={onWheel} style={{ '--pack-scale': packScale }}>
        {ripping && (
          <PackTear
            key={`p${ripId}`}
            interactive={interactive}
            onTorn={() => setRipping(false)}
          />
        )}
        <div key={`c${ripId}`} className={[styles.stripCards, ripping ? styles.stripHidden : ''].join(' ')}>
          {!ripping && choices.map((card, i) => (
            interactive ? (
              <DraggableDraftCard
                key={card.id}
                card={card}
                index={Math.min(i, 10)}
                fanAngle={choices.length === 5 ? (i - 2) * 1.5 : 0}
                displayScale={displayScale}
                selected={selectedId === card.id}
                onPick={onPick}
                dropTarget={dropTarget}
                clickable={clickable}
              />
            ) : (
              <CardReveal key={card.id} card={card} index={Math.min(i, 10)} className={styles.stripCard}>
                <span className={[styles.idleCard, card.rating > 80 || card.palette === 'icon' ? styles.impactCard : ''].join(' ')} style={{ '--fan-angle': `${choices.length === 5 ? (i - 2) * 1.5 : 0}deg`, '--wave-delay': `${600 + i * 90}ms` }}>
                  <PlayerCard card={card} displayScale={displayScale} selected={selectedId === card.id} />
                </span>
              </CardReveal>
            )
          ))}
        </div>
      </div>
    </div>
  );
}

// One draft-pack card wired for drag-to-dock. The strip scrolls
// (`overflow-x: auto`), so a real Framer Motion `drag` left on the in-place
// card would get visually clipped the instant it crossed the strip's own
// edge on its way down to the dock - instead, crossing a small threshold
// spawns a fixed-position portal ghost that follows the pointer 1:1
// (untouched by any ancestor's overflow), while the real card sits hidden
// (opacity 0, same layout slot) underneath. A plain tap - no threshold
// crossed - never spawns the ghost at all, so PlayerCard's own onClick
// still owns ordinary click/keyboard picking untouched.
//
// Dropping over `[data-squad-dock]` (dropTarget: 'dock') calls onPick
// directly: the real hidden card (still claiming `layoutId={card-${id}}`) is
// what actually performs the existing fly-to-dock morph the instant it
// reappears in SquadDock, so the ghost's only job is the live drag feedback,
// not the landing itself. Dropping over a specific `[data-chip-slot]`
// (dropTarget: 'chip') calls `onPick(card, targetCardId)` instead - no
// layoutId claim in this mode, since the drop only proposes a swap (the
// caller decides whether to actually commit it, e.g. behind a confirm step)
// rather than landing the card for real. Dropping anywhere invalid springs
// the ghost back to its origin rect and removes it - the untouched real card
// was there the whole time.
function DraggableDraftCard({ card, index, fanAngle = 0, displayScale, selected, onPick, dropTarget = 'dock', clickable = true }) {
  const nodeRef = useRef(null);
  const dragRef = useRef(null); // { startX, startY, rect, moved }
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

  function resolveTarget(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return dropTarget === 'chip' ? el?.closest('[data-chip-slot]') : el?.closest('[data-squad-dock]');
  }

  function setHighlight(el) {
    if (dropTarget === 'chip') {
      document.querySelectorAll('[data-chip-slot][data-drop-active]').forEach((node) => {
        if (node !== el) delete node.dataset.dropActive;
      });
      if (el) el.dataset.dropActive = 'true';
      return;
    }
    const dock = document.querySelector('[data-squad-dock]');
    if (dock) dock.dataset.dropActive = el ? 'true' : 'false';
  }

  function cleanupListeners() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }

  function onPointerDown(e) {
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
      if (nodeRef.current) nodeRef.current.style.touchAction = 'none';
      setGhostRect(s.rect);
    }
    e.preventDefault();
    x.set(dx);
    y.set(dy);
    const elapsed = Math.max(1, e.timeStamp - s.lastAt);
    const velocityX = (e.clientX - s.lastX) / elapsed;
    rotate.set(prefersReducedMotion() ? 0 : Math.max(-12, Math.min(12, -velocityX * 8)));
    s.lastX = e.clientX;
    s.lastAt = e.timeStamp;
    setHighlight(resolveTarget(e.clientX, e.clientY));
  }

  function onPointerUp(e) {
    const s = dragRef.current;
    cleanupListeners();
    dragRef.current = null;
    if (nodeRef.current) nodeRef.current.style.touchAction = '';
    setHighlight(null);
    if (!s?.moved) return; // a plain tap - PlayerCard's own onClick already fired (if clickable)
    const target = resolveTarget(e.clientX, e.clientY);
    if (target) {
      setGhostRect(null);
      x.set(0);
      y.set(0);
      rotate.set(0);
      if (dropTarget === 'chip') onPick(card, target.dataset.cardId);
      else onPick(card);
      playUiSound('drop');
      return;
    }
    springBack();
  }

  function onPointerCancel() {
    const s = dragRef.current;
    cleanupListeners();
    dragRef.current = null;
    if (nodeRef.current) nodeRef.current.style.touchAction = '';
    setHighlight(null);
    if (!s?.moved) return;
    springBack();
  }

  // Mount-only cleanup for the rare case this unmounts mid-drag (e.g. the
  // phase changes away entirely) without a pointerup/pointercancel ever
  // reaching window - cleanupListeners is redefined every render like every
  // other handler here, so there's nothing stale for the empty dep array to
  // miss.
  useEffect(() => () => {
    cleanupListeners();
    stopReturnAnimations();
    setHighlight(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <CardReveal
        ref={nodeRef}
        card={card}
        index={index}
        className={styles.stripCard}
        style={{ opacity: ghostRect ? 0 : 1 }}
        onPointerDown={onPointerDown}
      >
        <span className={[styles.idleCard, card.rating > 80 || card.palette === 'icon' ? styles.impactCard : ''].join(' ')} style={{ '--fan-angle': `${fanAngle}deg`, '--wave-delay': `${600 + index * 90}ms` }}>
          <PlayerCard
            card={card}
            layoutId={dropTarget === 'chip' ? undefined : `card-${card.id}`}
            displayScale={displayScale}
            selected={selected}
            onClick={clickable ? () => onPick(card) : undefined}
          />
        </span>
      </CardReveal>
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
          <PlayerCard card={card} displayScale={displayScale} tilt={false} />
        </m.div>,
        document.body,
      )}
    </>
  );
}
