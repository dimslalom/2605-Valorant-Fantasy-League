// Cross-DOM "fly to" - the shared primitive behind the prize fly-to-bank,
// the signing sequence's pay/land beats, and the pack-open card landings.
// Clones the source into a fixed-position layer under <body> (same idea as
// PackRip's drag ghost) so the flight is never clipped by an ancestor's
// overflow, animates it along a lifted arc onto the target's rect, then
// removes the clone. The real source element is the caller's to hide or
// unmount; this only ever touches the clone.
import { animate, MS, ANIME_EASE, gate } from './anime.js';

function rectOf(el) {
  return el.getBoundingClientRect();
}

// duration in ms, arc in px (how far the midpoint lifts above the straight
// line - negative lifts up, since screen y grows downward).
export function flyTo(sourceEl, targetEl, {
  duration = MS.travel,
  arc = -60,
  scaleTo = 1,
  rotate = 0,
  delay = 0,
  reducedMotion = false,
  runSpeed = 'normal',
  onLand,
} = {}) {
  const { instant, rate } = gate({ reducedMotion, runSpeed });

  if (instant || !sourceEl || !targetEl) {
    onLand?.();
    return { finished: Promise.resolve(), complete: () => {}, cancel: () => {} };
  }

  const a = rectOf(sourceEl);
  const b = rectOf(targetEl);

  const clone = sourceEl.cloneNode(true);
  clone.style.position = 'fixed';
  clone.style.left = `${a.left}px`;
  clone.style.top = `${a.top}px`;
  clone.style.width = `${a.width}px`;
  clone.style.height = `${a.height}px`;
  clone.style.margin = '0';
  clone.style.zIndex = '999';
  clone.style.pointerEvents = 'none';
  clone.style.willChange = 'transform, opacity';
  document.body.appendChild(clone);

  const x0 = 0, y0 = 0;
  const x1 = (b.left + b.width / 2) - (a.left + a.width / 2);
  const y1 = (b.top + b.height / 2) - (a.top + a.height / 2);
  const midX = x0 + (x1 - x0) * 0.5;
  const midY = y0 + (y1 - y0) * 0.5 + arc;
  const scaleMid = 1 + (scaleTo - 1) * 0.5;

  let landed = false;
  const finishLanding = () => {
    if (landed) return;
    landed = true;
    clone.remove();
    onLand?.();
  };

  const animation = animate(clone, {
    translateX: [x0, midX, x1],
    translateY: [y0, midY, y1],
    scale: [1, scaleMid, scaleTo],
    rotate: [0, rotate * 0.6, rotate],
    duration,
    delay,
    ease: ANIME_EASE.travel,
    onComplete: finishLanding,
  });
  animation.speed = rate;

  return {
    finished: animation.then(() => {}),
    complete: () => animation.complete(),
    cancel: () => { animation.pause(); clone.remove(); },
  };
}

// A card/token falling away (unchosen prize, discarded overflow) rather than
// landing anywhere - same clone-and-remove shape as flyTo, no destination.
export function fallAway(sourceEl, {
  duration = MS.enter,
  reducedMotion = false,
  runSpeed = 'normal',
  onDone,
} = {}) {
  const { instant, rate } = gate({ reducedMotion, runSpeed });
  if (instant || !sourceEl) { onDone?.(); return { finished: Promise.resolve() }; }

  const a = rectOf(sourceEl);
  const clone = sourceEl.cloneNode(true);
  clone.style.position = 'fixed';
  clone.style.left = `${a.left}px`;
  clone.style.top = `${a.top}px`;
  clone.style.width = `${a.width}px`;
  clone.style.height = `${a.height}px`;
  clone.style.margin = '0';
  clone.style.zIndex = '998';
  clone.style.pointerEvents = 'none';
  document.body.appendChild(clone);

  let done = false;
  const finish = () => { if (done) return; done = true; clone.remove(); onDone?.(); };

  const animation = animate(clone, {
    translateY: 40,
    opacity: 0,
    duration,
    ease: ANIME_EASE.in,
    onComplete: finish,
  });
  animation.speed = rate;

  return { finished: animation.then(() => {}), complete: () => animation.complete() };
}
