import { useCallback, useEffect, useRef } from 'react';
import { headingToward, pad, contains, unionRects } from './safeTriangle';

// Hover that is hard to trigger by accident and hard to lose by accident.
//
// Opening  — hover *intent*, not hover: the pointer has to settle. We sample
//            its position every `interval` ms and only open once it moved less
//            than `sensitivity` px between two samples, so a cursor sweeping
//            across the strip on its way to a button never opens it.
//
// Closing  — the "safe triangle" (the classic submenu fix): on leave we anchor
//            a triangle at the exit point spanning the target's silhouette —
//            the two corners with the widest angular spread as seen from that
//            point. While the pointer stays inside that cone it is clearly
//            travelling *toward* the target, so we hold the panel open even
//            though the pointer is technically outside it. Step out of the
//            cone, or stall inside it for `closeDelay`, and it closes.
//
// Touch/pen never opens on hover — those get the click path instead.

export default function useSafeHover({
  onOpen,
  onClose,
  isOpen = false,
  enabled = true,
  interval = 90,        // hover-intent sampling period
  sensitivity = 9,      // px of travel per sample that still counts as "settled"
  closeDelay = 420,     // grace while heading toward the target
  tolerance = 16,       // px of slop around the target rect
  // Optional selector for descendants that render OUTSIDE the ref's own box
  // (transformed children); their rects are unioned into the target area.
  unionSelector,
} = {}) {
  const ref = useRef(null);
  const closeTimer = useRef(0);
  const intentTimer = useRef(0);
  const prevPoint = useRef(null);   // pointer at the last sample tick
  const livePoint = useRef(null);   // pointer right now
  const watching = useRef(null);
  const open = useRef(isOpen);
  useEffect(() => { open.current = isOpen; }, [isOpen]);

  // Target = what the player can actually see. When `unionSelector` matches,
  // that union IS the target (the ref's own box is usually a wide, invisible
  // layout cell, and aiming the triangle at empty space defeats the point);
  // the children may be transformed anywhere, getBoundingClientRect follows.
  const targetRect = useCallback(() => {
    const el = ref.current;
    if (!el) return null;
    const rects = unionSelector
      ? [...el.querySelectorAll(unionSelector)]
          .map(c => c.getBoundingClientRect())
          .filter(c => c.width || c.height)
      : [];
    if (!rects.length) rects.push(el.getBoundingClientRect());
    return unionRects(rects);
  }, [unionSelector]);

  const stopWatching = useCallback(() => {
    if (watching.current) {
      window.removeEventListener('pointermove', watching.current);
      watching.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimeout(closeTimer.current);
    clearInterval(intentTimer.current);
    closeTimer.current = 0;
    intentTimer.current = 0;
    prevPoint.current = null;
    livePoint.current = null;
    stopWatching();
  }, [stopWatching]);

  const onPointerEnter = useCallback((e) => {
    if (!enabled || e.pointerType !== 'mouse') return;
    cancel();                       // a re-entry cancels any pending close
    if (open.current) return;
    prevPoint.current = { x: e.clientX, y: e.clientY };
    livePoint.current = prevPoint.current;
    intentTimer.current = setInterval(() => {
      const prev = prevPoint.current;
      const now = livePoint.current;
      if (!prev || !now) return;
      prevPoint.current = now;
      if (Math.hypot(now.x - prev.x, now.y - prev.y) < sensitivity) {
        cancel();
        onOpen?.();
      }
    }, interval);
  }, [enabled, cancel, interval, sensitivity, onOpen]);

  const onPointerMove = useCallback((e) => {
    if (livePoint.current) livePoint.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerLeave = useCallback((e) => {
    if (!enabled || e.pointerType !== 'mouse') return;
    cancel();
    if (!open.current) return;

    const box = targetRect();
    if (!box) { onClose?.(); return; }

    const exit = { x: e.clientX, y: e.clientY };
    const safe = pad(box, tolerance);

    const arm = () => {
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => { cancel(); onClose?.(); }, closeDelay);
    };
    arm();

    watching.current = (ev) => {
      const p = { x: ev.clientX, y: ev.clientY };
      // Over the target (or a gap between its parts): hold, but keep watching
      // — a real re-entry fires pointerenter, which cancels this outright.
      if (contains(safe, p)) { clearTimeout(closeTimer.current); return; }
      if (headingToward(p, exit, box)) { arm(); return; }  // still heading in
      cancel();
      onClose?.();
    };
    window.addEventListener('pointermove', watching.current);
  }, [enabled, cancel, targetRect, tolerance, closeDelay, onClose]);

  useEffect(() => cancel, [cancel]);

  return { ref, hoverProps: { onPointerEnter, onPointerMove, onPointerLeave } };
}
