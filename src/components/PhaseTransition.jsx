import { m } from 'motion/react';
import { wipeIn } from '../lib/motion';

// A broadcast-wipe wrapper for a top-level phase's whole screen. The caller
// wraps its full set of `{phase === 'x' && (...)}` sibling blocks in one
// <AnimatePresence mode="wait">, and gives each block's root element this
// wrapper with a `phaseKey` unique to that phase (or `${phase}:${subState}`
// when a single phase covers more than one visual scene) - that key is what
// AnimatePresence diffs on to know a phase change is an exit+enter pair, not
// an in-place update. `mode="wait"` sequences it as a clean wipe-out then
// wipe-in rather than a cross-fade, matching the rest of the house's
// broadcast-sharp register (see src/lib/motion.js).
export default function PhaseTransition({ phaseKey, children }) {
  return (
    <m.div key={phaseKey} variants={wipeIn} initial="initial" animate="animate" exit="exit">
      {children}
    </m.div>
  );
}
