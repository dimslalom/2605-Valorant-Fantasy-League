import { useEffect, useRef } from 'react';
import { AnimatePresence, m, useAnimationControls } from 'motion/react';
import backdrops from '../data/backdrops';
import useReducedMotion from '../lib/useReducedMotion';
import styles from './MatchBackdrop.module.css';

// The pool for a tournament kind is that kind's own art plus the shared
// crowd/filler pool, which is deliberately eligible everywhere (including
// kinds with no dedicated art yet, like 'enc'). Backdrops is empty-safe: an
// unknown kind or a still-empty manifest just yields an empty pool.
function poolFor(kind) {
  const named = backdrops[kind] ?? [];
  return [...named, ...backdrops.crowd];
}

// Wide enough to actually read as "zooming in" against a dimmed, scrimmed
// full-viewport image - the original 1.02/1.07/1.13 range (2-13%) was
// provably reaching the DOM correctly but was too subtle to perceive.
const ZOOM_SCALE = { 1: 1.04, 2: 1.14, 3: 1.25 };
// This component's own bespoke deceleration for the zoom transition - not
// the house --ease-out - kept as a literal array (motion.js's tokens don't
// cover it) the same way the tilt and travel effects each keep their own.
const ZOOM_EASE = [0.16, 1, 0.3, 1];
const ZOOM_DURATION = 0.8;

// The shake animation itself is 480ms - already longer than one 150ms round
// tick, which is fine, the effect is allowed to spill into the next round or
// two. What isn't fine is restarting it from scratch on every consecutive
// significant round (a close finish can hold several in a row): that reads
// as jittering rather than a shake, the same failure the zoom escalation had
// before it became a guarded, persistent state. This is a simpler time-based
// guard rather than state, since shake has no state of its own to be
// monotonic about - it just needs to not retrigger mid-flight.
const SHAKE_MS = 200;

// `variant` selects the image and is expected to change rarely - once per
// match series, plus up to twice more as `zoomLevel` escalates. `zoomLevel`
// (1-3) is a persistent state owned by the caller, not something this
// component animates through on its own: it renders whichever level it's
// given, and an FM `scale` animation carries it there and leaves it - so
// "zoomed in to 2" just stays at 2 until the caller passes a different
// level, the same way the caller intends it to read as a state rather than
// a pulse. `reaction` is unrelated: it only drives the one-shot shake
// flourish, animated on the same `controls` as an independent `y` motion
// value - Framer Motion composes scale and y into one transform natively,
// so the shake perturbs around whatever zoom level is currently active
// without either effect fighting or resetting the other (the CSS version
// this replaced had to read a shared --zoom-scale custom property to get
// the same result).
export default function MatchBackdrop({ active, mode = 'calm', kind = null, variant = 0, zoomLevel = 1, reaction = null }) {
  const controls = useAnimationControls();
  const shakeStartedAt = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    controls.start({
      scale: ZOOM_SCALE[zoomLevel] ?? ZOOM_SCALE[1],
      transition: { duration: reducedMotion ? 0 : ZOOM_DURATION, ease: ZOOM_EASE },
    });
  }, [zoomLevel, controls, reducedMotion]);

  useEffect(() => {
    if (reducedMotion || !reaction || reaction.kind !== 'shake') return;
    const now = Date.now();
    if (now - shakeStartedAt.current < SHAKE_MS) return; // let the in-flight shake finish
    shakeStartedAt.current = now;
    const amplitude = Math.max(0, Math.min(5, reaction.amplitude ?? 1.5));
    const duration = amplitude >= 5 ? 0.2 : 0.08;
    controls.start({
      x: [0, -amplitude, amplitude, -amplitude * 0.55, amplitude * 0.35, 0],
      transition: { duration, ease: 'easeInOut' },
    });
  }, [reaction, controls, reducedMotion]);

  if (!active) return null;

  const pool = poolFor(kind);
  const image = pool.length > 0 ? pool[Math.abs(variant) % pool.length] : null;

  return (
    <div className={[styles.backdrop, mode === 'live' ? styles.live : styles.calm].join(' ')} aria-hidden="true">
      <m.div
        className={styles.visual}
        initial={{ scale: ZOOM_SCALE[zoomLevel] ?? ZOOM_SCALE[1] }}
        animate={controls}
        style={{ transformOrigin: 'center' }}
      >
        {image && <img key={image} className={styles.image} src={image} alt="" />}
      </m.div>
      <div className={styles.scrim} />
      <AnimatePresence>
        {reaction?.kind === 'shake' && (reaction.amplitude ?? 0) >= 5 && (
          <m.div
            key={reaction.key}
            className={styles.impactVignette}
            initial={{ opacity: 0.78 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0.12 : 0.15 }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
