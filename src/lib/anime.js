// Anime.js adapter. This is the ONLY file that imports 'animejs' - every
// caller goes through here, so the app never hand-authors a duration or ease
// that could drift from src/lib/motion.js's tokens (mirrored from
// tokens.css). Framer Motion still owns layoutId morphs, AnimatePresence and
// drag spring-back; this file is for imperative, cross-DOM choreography that
// Framer can't express (see the anime.js pass plan).
import { animate, createTimeline, stagger, cubicBezier } from 'animejs';
import { DUR, EASE, STAGGER, PACK_STAGGER } from './motion.js';
import { speedMultiplier } from './useRunSpeed.js';

// Anime works in milliseconds; motion.js's DUR is authored in seconds for
// Framer. Convert once, here, so nothing downstream repeats the *1000.
export const MS = Object.fromEntries(Object.entries(DUR).map(([k, v]) => [k, Math.round(v * 1000)]));
export const STAGGER_MS = Math.round(STAGGER * 1000);
export const PACK_STAGGER_MS = Math.round(PACK_STAGGER * 1000);

// Anime's ease slot takes a function or a named string, not a raw
// cubic-bezier array - wrap each of motion.js's curves once.
export const ANIME_EASE = {
  out: cubicBezier(...EASE.out),
  in: cubicBezier(...EASE.in),
  travel: cubicBezier(...EASE.travel),
};

export { animate, createTimeline, stagger };

// Every flight/sequence in the app is gated the same way: collapsed under
// Reduce Motion (state still commits, just instantly) and scaled by the
// player's chosen run speed (normal/fast/instant). `rate` feeds Anime's own
// `playbackRate`; `instant` tells a caller to skip building the animation at
// all and fire its landing callback synchronously.
export function gate({ reducedMotion = false, runSpeed = 'normal' } = {}) {
  // speedMultiplier scales DURATIONS (fast = 0.45x as long); Anime's `.speed`
  // is a PLAYBACK rate, so it takes the inverse - fast plays ~2.2x quicker.
  const multiplier = speedMultiplier(runSpeed);
  return { instant: reducedMotion || multiplier === 0, rate: multiplier ? 1 / multiplier : 1 };
}

// A short, sharp confirmation pulse on a landed target - counters, banked
// totals. No glow: a scale beat only, on the house ease.
export function bump(el, { duration = MS.transform, scale = 1.12 } = {}) {
  if (!el) return;
  animate(el, {
    scale: [1, scale, 1],
    duration,
    ease: ANIME_EASE.out,
  });
}
