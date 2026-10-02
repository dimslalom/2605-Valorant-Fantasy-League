import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TacticCard } from './SeriesCardTable.jsx';
import { flyTo } from '../lib/flight';
import { animate, bump, gate, MS, ANIME_EASE } from '../lib/anime';
import styles from './TacticReturn.module.css';

// How long the played tactic sits on screen before it leaves.
const HOLD_MS = 380;

// What a finished map did to the tactic you played, shown once the dock is
// back on screen (it stands down during a live map). The card rises into the
// middle of the screen, holds a beat, then either flies home into its slot in
// the dock (map won, the card was kept) or greys out and falls away (map
// lost, the card is spent). No label: the motion is the message.
export default function TacticReturn({ card, won, reducedMotion, runSpeed, onDone }) {
  const cardRef = useRef(null);
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; });

  useEffect(() => {
    const el = cardRef.current;
    const finish = () => doneRef.current?.();
    const { instant, rate } = gate({ reducedMotion, runSpeed });
    if (!el || instant) {
      const timer = setTimeout(finish, 0);
      return () => clearTimeout(timer);
    }

    let flight = null;
    let exit = null;
    const enter = animate(el, {
      opacity: [0, 1],
      translateY: [14, 0],
      duration: MS.enter,
      ease: ANIME_EASE.out,
    });
    enter.speed = rate;

    const timer = setTimeout(() => {
      // Settle the entrance first: a flight clones this node, and a clone
      // taken mid-fade would carry that half-opacity all the way home.
      enter.complete();
      el.style.opacity = '1';
      const target = won ? document.querySelector(`[data-tactic-slot="${card.uid}"]`) : null;
      if (target) {
        const from = el.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        flight = flyTo(el, target, {
          scaleTo: to.width / from.width,
          rotate: -4,
          reducedMotion,
          runSpeed,
          onLand: () => { bump(target); finish(); },
        });
        el.style.visibility = 'hidden';
        return;
      }
      exit = animate(el, {
        opacity: [1, 0],
        scale: [1, 0.8],
        translateY: [0, 22],
        rotate: [0, -6],
        duration: MS.hero,
        ease: ANIME_EASE.in,
        onBegin: () => { el.style.filter = 'grayscale(1) brightness(0.5)'; },
        onComplete: finish,
      });
      exit.speed = rate;
    }, (MS.enter + HOLD_MS) / rate);

    return () => {
      clearTimeout(timer);
      enter.pause();
      exit?.pause();
      flight?.cancel();
    };
    // Plays once per card; the parent keys this component on the card's uid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className={styles.stage} aria-hidden="true">
      <div ref={cardRef} className={styles.card}>
        <TacticCard instance={card} disabled />
      </div>
    </div>,
    document.body,
  );
}
