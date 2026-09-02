import { useEffect, useRef } from 'react';
import { m, useMotionValue, useTransform, animate } from 'motion/react';
import { assetPath } from '../lib/utils';
import { DUR, EASE } from '../lib/motion';
import styles from './PackTear.module.css';

// Drag distance (px) past which a release counts as a tear rather than a
// bounce-back - also the domain's second stop, so the same curve driving the
// live peel keeps running into the fling-off extreme once torn instead of a
// second, independently-animated one fighting it for the same motion value.
// Scaled to the pack's own 200px width, not an arbitrary round number - the
// original 150/300 dragged the strip 1.5x the pack's own width before it
// even tore, reading as way more horizontal travel than a peel needs.
const TEAR_THRESHOLD = 70;
const TEAR_FLY = 140;
const EASE_TEAR = [0.25, 1, 0.5, 1]; // sharp, confident - no overshoot
const SPECTATOR_DELAY = 260; // beat before a pack with no local hands on it tears itself

// The universal pack-opening moment: three still images (inside foil, front
// body, and the draggable top foil) in a 3D perspective box. A local player
// drags the top foil right to tear it off; PackRip passes `interactive:
// false` for a pack it's just narrating (a CPU roll, another player's turn
// in Multiplayer) and this plays the identical tear on a short timer instead
// of waiting on a pointer nobody's using.
//
// The tear-off is one imperative `animate(x, TEAR_FLY, ...)` call, not an
// AnimatePresence `exit` - that's deliberate: with `drag` disabled (the
// non-interactive path), a bound-via-style motion value's own `exit`
// animation never actually runs, so nothing was ever telling PackRip the
// tear had finished. Driving `x` imperatively both here and for the
// drag-release snap-back works identically whether or not `drag` is live,
// and `onComplete` is an unambiguous "the fling-off is done" signal for
// `onTorn` - PackRip swaps to the card strip only once it fires.
export default function PackTear({ interactive, onTorn }) {
  const x = useMotionValue(0);
  const rotateX = useTransform(x, [0, TEAR_THRESHOLD, TEAR_FLY], [0, -60, -110]);
  const rotateY = useTransform(x, [0, TEAR_THRESHOLD, TEAR_FLY], [0, -45, -95]);
  const rotateZ = useTransform(x, [0, TEAR_THRESHOLD, TEAR_FLY], [0, 15, 35]);
  const opacity = useTransform(x, [TEAR_THRESHOLD, TEAR_FLY], [1, 0]);
  const torn = useRef(false);

  function finishTear() {
    if (torn.current) return;
    torn.current = true;
    animate(x, TEAR_FLY, { duration: DUR.enter, ease: EASE_TEAR, onComplete: onTorn });
  }

  useEffect(() => {
    if (interactive) return undefined;
    const timer = setTimeout(finishTear, SPECTATOR_DELAY);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  // Space/Enter tears the pack even without focus on the tiny foil-drag
  // handle below - this component only mounts for the duration of the tear
  // moment, so scoping the listener to its own lifetime (rather than a
  // page-level "primary action" hookup) keeps it correct everywhere PackRip
  // is used without each caller having to wire it in. Skipped while focus
  // sits on a control that already owns Space/Enter itself (the bar's
  // buttons, a link, a text field) so e.g. tabbing to "Keep squad" and
  // pressing Space doesn't also tear the pack out from under it.
  useEffect(() => {
    if (!interactive) return undefined;
    function onKey(e) {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
      e.preventDefault();
      finishTear();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  function handleDragEnd() {
    if (x.get() < TEAR_THRESHOLD) {
      animate(x, 0, { duration: DUR.transform, ease: EASE.out });
    } else {
      finishTear();
    }
  }

  return (
    <div className={styles.packWrap} aria-hidden={!interactive}>
      <img className={styles.layerInside} src={assetPath('/assets/pack/Card-Inside.png')} alt="" />
      <img className={styles.layerFront} src={assetPath('/assets/pack/Card-Front.png')} alt="" />

      <m.div
        className={styles.tearStrip}
        style={{ x, rotateX, rotateY, rotateZ, opacity }}
        drag={interactive ? 'x' : false}
        dragConstraints={interactive ? { left: 0, right: 100 } : undefined}
        dragElastic={interactive ? 0.1 : undefined}
        dragMomentum={false}
        onDragEnd={interactive ? handleDragEnd : undefined}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? 'Tear the pack open' : undefined}
        onKeyDown={interactive ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finishTear(); }
        } : undefined}
      >
        <img className={styles.tearImg} src={assetPath('/assets/pack/Card-Top.png')} alt="" draggable={false} />
      </m.div>
    </div>
  );
}
