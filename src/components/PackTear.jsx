import { useEffect, useRef } from 'react';
import { assetPath } from '../lib/utils';
import { animate as animeAnimate, MS, ANIME_EASE } from '../lib/anime';
import useReducedMotion from '../lib/useReducedMotion';
import { playUiSound } from '../lib/gameAudio';
import styles from './PackTear.module.css';

// The universal pack-opening moment: the inside and front of the pack, and the foil strip
// across its top. Dragging tears the strip progressively: the tear line follows your finger
// left to right, the torn piece curls up from that line (more if you pull upward), and a
// partial tear stays torn. Once the tear reaches the far edge the piece comes free, follows
// the pointer, and flies off along the direction you threw it.
//
// `interactive: false` (a CPU roll, another player's pack) plays the same tear on a timer.
// Space/Enter tears it too. Reduced motion skips straight to torn. `front` (optional) replaces the
// printed front art, so another app can brand the same pack.

const ART_W = 595;
const STRIP_H = 51;      // foil strip height in the 595x842 art
const SPECTATOR_DELAY = 260;
const AUTO_TEAR_MS = 420;
const TAP = 6;           // px of travel before a press counts as a pull

// A ragged vertical tear line at x, top to bottom: both pieces use the same points so they meet.
const zig = (x, s) => [0, 1, 2, 3, 4, 5].map(k => [x + (k % 2 ? 3 : -2), (k / 5) * (s + 4)]);
const poly = pts => `polygon(${pts.map(([x, y]) => `${x}px ${y}px`).join(',')})`;

export default function PackTear({ interactive, onTorn, front }) {
  const wrapRef = useRef(null);
  const bodyRef = useRef(null);
  const restRef = useRef(null);
  const flapRef = useRef(null);
  const st = useRef({ tear: 0, lift: 0, done: false, finished: false, auto: false, drag: null, free: null, trail: [] });
  const reducedMotion = useReducedMotion();

  const size = () => {
    const w = wrapRef.current.offsetWidth;
    return { w, s: (w * STRIP_H) / ART_W };
  };

  // Paint the current tear: the attached piece right of the line, the torn piece left of it,
  // hinged on the line and curled up by `lift` degrees.
  const paint = (dx = 0, dy = 0, extraRot = 0) => {
    const { w, s } = size();
    const x = st.current.tear * w;
    const line = zig(x, s);
    restRef.current.style.clipPath = poly([[w, 0], [w, s + 4], ...[...line].reverse()]);
    flapRef.current.style.clipPath = poly([[0, 0], ...line, [0, s + 4]]);
    flapRef.current.style.transformOrigin = `${x}px ${s}px`;
    flapRef.current.style.transform = `translate(${dx}px, ${dy}px) rotate(${-(st.current.lift + extraRot)}deg)`;
    wrapRef.current.dataset.tearing = st.current.tear > 0 ? 'true' : 'false';
  };

  const finish = () => {
    if (st.current.finished) return;
    st.current.finished = true;
    if (bodyRef.current && !reducedMotion) {
      animeAnimate(bodyRef.current, { translateY: 60, rotateX: 25, opacity: [1, 0], duration: MS.enter, ease: ANIME_EASE.in });
      setTimeout(onTorn, MS.enter);
    } else onTorn?.();
  };

  // The strip is free: throw it along velocity (px/ms) from wherever it was let go.
  const fling = (vx, vy, from = { dx: 0, dy: 0 }) => {
    if (st.current.done) return;
    st.current.done = true;
    playUiSound('lift');
    if (reducedMotion) { flapRef.current.style.opacity = 0; finish(); return; }
    const speed = Math.hypot(vx, vy);
    const k = speed < 0.4 ? 0.4 / Math.max(speed, 0.01) : 1;   // a dead drop still gets tossed
    const tx = from.dx + vx * k * 380;
    const ty = from.dy + (vy * k - 0.25) * 380;
    const spin = st.current.lift + 30 * Math.sign(vx || 1);
    flapRef.current.animate(
      [{ transform: flapRef.current.style.transform, opacity: 1 }, { transform: `translate(${tx}px, ${ty}px) rotate(${-spin}deg)`, opacity: 0 }],
      { duration: 380, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'forwards' },
    );
    finish();
  };

  // Advance the tear to t (0..1) and curl the torn piece; past the end it comes free.
  const tearTo = (t, pullUp = 0) => {
    const s = st.current;
    if (t > s.tear) {
      if (Math.floor(t * 8) > Math.floor(s.tear * 8)) playUiSound('rattle');   // the foil crackles as it goes
      s.tear = Math.min(1, t);
    }
    s.lift = 10 + s.tear * 22 + Math.min(40, Math.max(0, pullUp) * 0.35);
    paint();
  };

  const autoTear = () => {
    if (st.current.done || st.current.auto) return;
    if (reducedMotion) { fling(0.6, -0.3); return; }
    st.current.auto = true;
    const t0 = performance.now();
    const start = st.current.tear;
    const step = now => {
      const k = Math.min(1, (now - t0) / AUTO_TEAR_MS);
      tearTo(start + (1 - start) * (1 - (1 - k) ** 2), k * 30);
      if (k < 1) requestAnimationFrame(step);
      else fling(0.9, -0.6);
    };
    requestAnimationFrame(step);
  };

  useEffect(() => { paint(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (interactive) return undefined;
    const timer = setTimeout(autoTear, SPECTATOR_DELAY);
    return () => clearTimeout(timer);
  }, [interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Space/Enter tears the pack without focusing the strip, unless focus is on a control that owns those keys.
  useEffect(() => {
    if (!interactive) return undefined;
    function onKey(e) {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
      e.preventDefault();
      autoTear();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDown = e => {
    if (!interactive || st.current.done || st.current.auto) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    st.current.drag = { x: e.clientX, y: e.clientY, tear: st.current.tear, moved: false };
    st.current.trail = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
  };

  const onMove = e => {
    const s = st.current;
    if (!s.drag || s.done) return;
    const dx = e.clientX - s.drag.x;
    const dy = e.clientY - s.drag.y;
    if (Math.hypot(dx, dy) > TAP) s.drag.moved = true;
    s.trail = [...s.trail.slice(-4), { x: e.clientX, y: e.clientY, t: e.timeStamp }];
    if (s.free) {
      // Torn loose: the piece hangs from the pointer.
      paint(e.clientX - s.free.x, e.clientY - s.free.y, Math.max(-20, Math.min(20, dx * 0.05)));
      return;
    }
    tearTo(s.drag.tear + Math.max(0, dx) / size().w, -dy);
    if (s.tear >= 1) s.free = { x: e.clientX, y: e.clientY };
  };

  const onUp = e => {
    const s = st.current;
    if (!s.drag) return;
    onMove(e);   // the release point counts, even if no move event landed there
    const { moved } = s.drag;
    s.drag = null;
    if (s.free) {
      const a = s.trail[0];
      const dt = Math.max(1, e.timeStamp - a.t);
      fling((e.clientX - a.x) / dt, (e.clientY - a.y) / dt, { dx: e.clientX - s.free.x, dy: e.clientY - s.free.y });
      return;
    }
    if (!moved) { autoTear(); return; }                 // a tap tears it for you
    s.lift = 6 + s.tear * 10;                           // let go mid-tear: the piece relaxes, stays torn
    flapRef.current.style.transition = 'transform 220ms ease-out';
    paint();
    setTimeout(() => { if (flapRef.current) flapRef.current.style.transition = ''; }, 220);
  };

  const top = assetPath('/assets/pack/Card-Top.png');
  return (
    <div
      ref={wrapRef}
      className={styles.packWrap}
      data-pack-body="true"
      aria-hidden={!interactive}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? 'Tear the pack open' : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDragStart={e => e.preventDefault()}   // never let the browser drag the art as an image
    >
      <div ref={bodyRef} className={styles.packBody}>
        <img className={styles.layerInside} src={assetPath('/assets/pack/Card-Inside.png')} alt="" draggable={false} />
        {front ? <div className={styles.layerFront}>{front}</div> : <img className={styles.layerFront} src={assetPath('/assets/pack/Card-Front.png')} alt="" draggable={false} />}
        <div ref={restRef} className={styles.foil}><img src={top} alt="" draggable={false} /></div>
      </div>
      <div ref={flapRef} className={`${styles.foil} ${styles.flap}`}><img src={top} alt="" draggable={false} /></div>
    </div>
  );
}
