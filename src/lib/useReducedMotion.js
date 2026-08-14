import { useSyncExternalStore } from 'react';

// One place to ask "should this move?". Previously re-implemented as a bare
// matchMedia(...).matches read at seven call sites, none of which subscribed —
// so toggling the OS setting mid-session did nothing until the next remount.
//
// useSyncExternalStore keeps every consumer in step with the live media query
// and gives a stable `false` on the server / before hydration.

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

export default function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Imperative escape hatch for code paths that run outside render — event
// handlers, timers, the tilt hook's pointermove. Prefer the hook in components.
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia(QUERY).matches;
}
