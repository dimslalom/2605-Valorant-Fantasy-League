import { forwardRef } from 'react';
import { m } from 'motion/react';
import { tierEntrance, STAGGER } from '../lib/motion';

// Escalating entrance keyed by tier — one idea, scaled, not a bespoke
// animation per rarity. bronze/silver land fast and flat; gold gets a held
// beat and a light sweep; icon/prestige gets the focal-moment vertical wipe
// (see tierEntrance in src/lib/motion.js). `index` adds the sibling stagger
// on top of tierEntrance's own baked-in delay (gold's held beat), so a pack
// of five still reveals left-to-right rather than every card landing at once.
//
// Forwards ref + any extra props (e.g. pointer handlers) straight onto the
// underlying m.div — PackRip's drag-to-dock gesture needs a measurable node
// and its own pointerdown listener on this exact element.
const CardReveal = forwardRef(function CardReveal({ card, index = 0, className, style, children, ...rest }, ref) {
  const variant = tierEntrance(card.palette);
  const baseDelay = variant.animate.transition?.delay ?? 0;
  return (
    <m.div
      ref={ref}
      className={className}
      style={style}
      initial={variant.initial}
      animate={{
        ...variant.animate,
        transition: { ...variant.animate.transition, delay: baseDelay + index * STAGGER },
      }}
      {...rest}
    >
      {children}
    </m.div>
  );
});

export default CardReveal;
