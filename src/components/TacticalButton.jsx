import { m } from 'motion/react';
import { DUR, EASE } from '../lib/motion';

// The upgraded press feedback for the run's decisive action buttons — Play
// your match, Continue, Reroll, and their Multiplayer equivalents (advance
// match, Skip pack, Done shopping, Return to lobby, Start game). Every OTHER
// button in the app still gets the global CSS `:active` press defined once in
// index.css (`translateY(1px) scale(0.985)`); duplicating that here with
// `whileTap` would just have the two systems fight over the same `transform`
// property. `data-no-press` opts this button out of that global rule so this
// one, more deliberate press (a firmer scale plus a brightness dip) is the
// only thing driving its `transform`/`filter`.
export default function TacticalButton({ className, children, ...props }) {
  return (
    <m.button
      className={className}
      data-no-press
      whileTap={{ scale: 0.97, filter: 'brightness(0.85)' }}
      transition={{ duration: DUR.micro, ease: EASE.out }}
      {...props}
    >
      {children}
    </m.button>
  );
}
