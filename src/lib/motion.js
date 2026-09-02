// The motion-token bridge. The Impeccable design-lint detector has no motion
// rule, so nothing catches a rogue Framer Motion `duration: 0.42` the way it
// catches an off-ramp color or font-size - this file, plus
// test/motionTokens.test.js asserting it mirrors src/styles/tokens.css, is
// the enforcement point instead. Durations here are in SECONDS (Framer
// Motion's unit); tokens.css is authored in ms, so every value is /1000 of
// its CSS twin. Zero imports so a plain Node test can load this file without
// a DOM.

export const DUR = {
  micro: 0.12,      // --dur-micro   - color / opacity swaps
  hover: 0.15,      // --dur-hover   - hover affordance
  transform: 0.2,   // --dur-transform - lift, scale, slide
  enter: 0.32,      // --dur-enter   - element entrance
  hero: 0.48,       // --dur-hero    - championship / hero entrance
  travel: 0.6,      // --dur-travel  - measured bracket movement
};

// cubic-bezier control points, matching tokens.css 1:1.
export const EASE = {
  out: [0.2, 0.8, 0.2, 1],     // --ease-out - the house curve
  in: [0.5, 0, 0.85, 0.4],     // --ease-in  - exits only
  travel: [0.5, 0, 0.2, 1],    // --ease-travel - bracket travel path (unused by FM; WAAPI owns it)
};

export const STAGGER = 0.04; // --stagger
export const PACK_STAGGER = 0.065; // --pack-stagger

// ── R1 Chrome - broadcast-sharp, cubic-bezier only, no spring ──────────────

export const riseIn = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.hero, ease: EASE.out } },
  exit: { opacity: 0, transition: { duration: DUR.hover, ease: EASE.in } },
};

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR.enter, ease: EASE.out } },
  exit: { opacity: 0, transition: { duration: DUR.hover, ease: EASE.in } },
};

// Bottom sheet: rises from its own edge, per DESIGN.md (not a centered modal).
export const sheetRise = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.transform, ease: EASE.out } },
  exit: { opacity: 0, y: 16, transition: { duration: DUR.hover, ease: EASE.in } },
};

// SquadDock hover preview: a quick pop, not a morph target (see PlayerCard's
// layoutId one-owner rule - the chip stays mounted alongside this).
export const chipPop = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.transform, ease: EASE.out } },
  exit: { opacity: 0, transition: { duration: DUR.micro, ease: EASE.in } },
};

// Full phases move as one restrained broadcast panel. Descendants should not
// repeat this entrance with their own CSS animation.
export const wipeIn = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.enter, ease: EASE.out } },
  exit: { opacity: 0, y: -4, transition: { duration: DUR.transform, ease: EASE.in } },
};

// ── R2 Card - spring physics, PlayerCard only ──────────────────────────────
// Legitimate exception: DESIGN.md already grants PlayerCard's glare layer a
// departure from the No-Glow rule as "a physical foil card under light." This
// is the only object in the app that behaves like a thing rather than a
// readout, so it's the only place a spring belongs.

export const cardSpring = { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 };
export const cardSpringSoft = { type: 'spring', stiffness: 260, damping: 28, mass: 1 };

// A dock card leaving for good (released, poached away) - falls and rotates
// off rather than just fading, so the vacancy reads as something that just
// happened, not a slot that was always empty.
export const cardLeave = {
  exit: {
    opacity: 0,
    y: 28,
    rotate: -6,
    scale: 0.92,
    transition: cardSpringSoft,
  },
};

// ── R3 Drama - rationed. Only from roundSignificance()/card.palette. ───────
// Triggers: card.tier in {iconic, prestige} · desc.isOvertime ·
// desc.isStreakBreak · elimination. Never on a routine transition.

export const glitchPulse = {
  animate: {
    x: [0, -3, 2, -1, 0],
    filter: ['saturate(1)', 'saturate(1.4) hue-rotate(-4deg)', 'saturate(1)'],
    transition: { duration: 0.18, ease: EASE.out },
  },
};

// One of R3's four rationed triggers: elimination. A single authored
// sequence - glitch, then settle into a desaturated hold - rather than a
// pulse that snaps back to normal; being knocked out is a state, not a
// blip, so the color drains and stays drained.
export const eliminationFlash = {
  animate: {
    x: [0, -3, 2, -1, 0],
    filter: ['saturate(1)', 'saturate(1.4) hue-rotate(-4deg)', 'saturate(0.25) contrast(1.05)'],
    transition: { duration: DUR.hero, ease: EASE.out },
  },
};

// Escalating entrance keyed by card tier - one physical deal, scaled by
// rarity. Every branch stays on transform/opacity and lands through the card
// spring; tier-specific light punctuation lives in PackRip's material layer.
export function tierEntrance(palette) {
  switch (palette) {
    case 'icon':
    case 'prestige':
      return {
        initial: { opacity: 0.35, x: 18, y: 18, rotateZ: 3 },
        animate: {
          opacity: 1,
          x: 0,
          y: 0,
          rotateZ: 0,
          transition: { ...cardSpringSoft, opacity: { duration: DUR.transform } },
        },
      };
    case 'gold':
      return {
        initial: { opacity: 0, x: 16, y: 14, rotateZ: 2 },
        animate: {
          opacity: 1,
          x: 0,
          y: 0,
          rotateZ: 0,
          transition: { ...cardSpring, opacity: { duration: DUR.transform } },
        },
      };
    default:
      return {
        initial: { opacity: 0, x: 14, y: 8 },
        animate: { opacity: 1, x: 0, y: 0, transition: { ...cardSpring, opacity: { duration: DUR.transform } } },
      };
  }
}
