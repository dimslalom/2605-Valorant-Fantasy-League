import { forwardRef } from 'react';
import { m } from 'motion/react';
import { tierEntrance, PACK_STAGGER, DUR, EASE } from '../lib/motion';
import useReducedMotion from '../lib/useReducedMotion';

// Escalating entrance keyed by tier - one spring-deal idea, scaled, not a
// bespoke animation per rarity. `index` adds the pack's authored 65ms sibling
// stagger so five cards land left-to-right. Reduced motion collapses both the
// spatial deal and the delay into one 120ms opacity response.
//
// Forwards ref + any extra props (e.g. pointer handlers) straight onto the
// underlying m.div - PackRip's drag-to-dock gesture needs a measurable node
// and its own pointerdown listener on this exact element.
const CardReveal = forwardRef(function CardReveal({ card, index = 0, className, style, children, ...rest }, ref) {
  const reducedMotion = useReducedMotion();
  const variant = tierEntrance(card.palette);
  const baseDelay = variant.animate.transition?.delay ?? 0;
  return (
    <m.div
      ref={ref}
      className={className}
      style={style}
      initial={reducedMotion ? { opacity: 0 } : variant.initial}
      animate={reducedMotion
        ? { opacity: 1, transition: { duration: DUR.micro, ease: EASE.out } }
        : {
            ...variant.animate,
            transition: { ...variant.animate.transition, delay: baseDelay + index * PACK_STAGGER },
          }}
      {...rest}
    >
      {children}
    </m.div>
  );
});

export default CardReveal;
