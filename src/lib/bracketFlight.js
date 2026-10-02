// Shared bracket-travel flight: a winner's row clones itself and dogleg-
// flies (horizontal, then vertical) from its old round's cell to its new
// one. Used by both PerfectRun.jsx (solo/endless) and Multiplayer.jsx, which
// used to hand-roll the identical WAAPI animation twice. `moves` are already
// resolved to DOM elements by the caller (each bracket finds its own
// fromEl/toEl by round key + team id); this only does the measuring, the
// clone, the flight, and staggering multiple winners leaving one after
// another instead of all at once.
import { animate, ANIME_EASE, STAGGER_MS, gate } from './anime.js';

// `moves`: [{ id, fromEl, toEl, cloneClass, prepareClone(clone) }]
// `base`: the container's getBoundingClientRect(), moves are positioned
// relative to it (the overlay must share that same offset parent).
export function flyBracketMoves({
  moves,
  base,
  overlay,
  duration,
  reducedMotion = false,
  runSpeed = 'normal',
  onArrive,
}) {
  const { instant, rate } = gate({ reducedMotion, runSpeed });

  if (instant || !moves?.length || !overlay || !base) {
    moves?.forEach(move => onArrive?.(move.id));
    return { finished: Promise.resolve(), cancel: () => {} };
  }

  const cleanups = [];
  const running = [];
  let cancelled = false;

  const promises = moves.map((move, index) => {
    const { id, fromEl, toEl, cloneClass, prepareClone } = move;
    if (!fromEl || !toEl) { onArrive?.(id); return Promise.resolve(); }

    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const clone = fromEl.cloneNode(true);
    if (cloneClass) clone.classList.add(cloneClass);
    prepareClone?.(clone);
    clone.style.position = 'absolute';
    clone.style.left = '0';
    clone.style.top = '0';
    clone.style.width = `${a.width}px`;
    clone.style.height = `${a.height}px`;
    overlay.appendChild(clone);
    cleanups.push(() => clone.remove());

    const x0 = a.left - base.left, y0 = a.top - base.top;
    const x1 = b.left - base.left, y1 = b.top - base.top;
    const bridgeX = x0 + (x1 - x0) * 0.5;

    const animation = animate(clone, {
      // Even keyframe segments over `duration` reproduce the old WAAPI
      // offsets (0.35/0.65): horizontal first, then vertical, then settle.
      translateX: [x0, bridgeX, bridgeX, x1],
      translateY: [y0, y0, y1, y1],
      duration,
      delay: index * STAGGER_MS,
      ease: ANIME_EASE.travel,
      onComplete: () => { if (!cancelled) onArrive?.(id); },
    });
    animation.speed = rate;
    running.push(animation);
    return animation.then(() => {});
  });

  const finished = Promise.all(promises).then(() => {
    if (!cancelled) cleanups.forEach(fn => fn());
  });

  return {
    finished,
    cancel: () => {
      cancelled = true;
      running.forEach(a => a.pause());
      cleanups.forEach(fn => fn());
    },
  };
}
