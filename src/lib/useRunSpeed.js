import { useCallback, useState } from 'react';

// Persistent Normal/Fast/Instant preference for Gauntlet's auto-advance
// pacing — a speedrunner sets this once instead of mashing skip on every
// timer, every run. Speed scales duration by a multiplier rather than
// swapping in different fixed values, so it composes cleanly with
// roundEvents.js's own `roundPacing(desc, opts)` seam (which already exists
// for exactly this: a caller-supplied `delayFor` slowdown/speedup hook) —
// the engine file itself is never touched.
export const RUN_SPEEDS = ['normal', 'fast', 'instant'];

const MULTIPLIER = { normal: 1, fast: 0.45, instant: 0 };

export function speedMultiplier(speed) {
  return MULTIPLIER[speed] ?? MULTIPLIER.normal;
}

export function scaleDuration(ms, speed) {
  return Math.round(ms * speedMultiplier(speed));
}

// `initial` / `onChange` let the caller own persistence (PerfectRun already
// has a loadSaves/saveSaves pair keyed on its own localStorage blob — this
// hook doesn't duplicate that storage concern, just the read/write moment).
export default function useRunSpeed(initial = 'normal', onChange) {
  const [speed, setSpeedState] = useState(RUN_SPEEDS.includes(initial) ? initial : 'normal');

  const setSpeed = useCallback((next) => {
    if (!RUN_SPEEDS.includes(next)) return;
    setSpeedState(next);
    onChange?.(next);
  }, [onChange]);

  return [speed, setSpeed];
}
