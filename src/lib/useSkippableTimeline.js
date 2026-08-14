import { useCallback, useEffect, useRef, useState } from 'react';
import useReducedMotion from './useReducedMotion';

// A cancellable auto-advance.
//
// The run used to advance itself with bare setTimeout calls — 1900ms after the
// intro splash, 2200ms after a board completes, 1700ms after a series ends —
// with no countdown and no way out. A player sees each of those dozens of times
// per run. Two HIG rules apply directly:
//
//   "Let people cancel motion. As much as possible, don't make people wait for
//    an animation to complete before they can do anything, especially if they
//    have to experience the animation more than once."          — Motion
//   "Minimize use of time-boxed interface elements... Prefer dismissing views
//    with an explicit action."                    — Accessibility > Cognitive
//
// So every auto-advance goes through here: it reports `remaining` so the UI can
// show the wait, and `skip` so the player can end it. Under Reduce Motion the
// wait collapses to `reducedDuration` (0 by default) and the phase advances at
// once. Timers are cleared on unmount — the discipline the run loop already
// had, now shared.
//
//   const { progress, seconds, skip } = useSkippableTimeline({
//     duration: 2200,
//     active: boardState === 'complete',
//     onDone: advance,
//   });
//
export default function useSkippableTimeline({
  duration,
  onDone,
  active = true,
  reducedDuration = 0,
}) {
  // Derived during render rather than stashed in a ref, so toggling Reduce
  // Motion mid-session re-derives the span instead of waiting for a remount.
  const reduced = useReducedMotion();
  const span = reduced ? reducedDuration : duration;

  const [remaining, setRemaining] = useState(span);

  // Latest-callback ref, assigned in an effect so render stays pure. Without
  // it, a caller passing an inline arrow would restart the timer every render.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const settledRef = useRef(false);

  // The timeout and an explicit skip race each other; only one may win.
  const finish = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    setRemaining(0);
    onDoneRef.current?.();
  }, []);

  useEffect(() => {
    if (!active) return undefined;

    settledRef.current = false;
    const startedAt = performance.now();

    // rAF rather than a 100ms interval: the countdown drives a draining bar,
    // and this keeps it smooth while pausing automatically in a background tab.
    let frame = requestAnimationFrame(function tick() {
      const left = Math.max(0, span - (performance.now() - startedAt));
      setRemaining(left);
      if (left > 0) frame = requestAnimationFrame(tick);
    });
    const timeout = setTimeout(finish, span);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, [active, span, finish]);

  return {
    remaining,
    // 1 → 0, for a draining bar: style={{ '--remaining': progress }}
    progress: span > 0 ? remaining / span : 0,
    seconds: Math.ceil(remaining / 1000),
    skip: finish,
  };
}
