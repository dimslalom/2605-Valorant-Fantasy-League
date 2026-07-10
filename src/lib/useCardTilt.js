import { useCallback, useEffect, useRef } from 'react';

// Pointer-driven 3D tilt. Writes CSS vars (--rx, --ry, --gx, --gy, --glare)
// straight onto the target node inside a rAF — no React re-render per move.
// The consuming CSS decides what the vars mean, so any card layout works.
function motionDisabled() {
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    window.matchMedia('(hover: none)').matches
  );
}

export default function useCardTilt({ maxTilt = 10, disabled = false } = {}) {
  const tiltRef = useRef(null);
  const frame = useRef(0);

  const onPointerMove = useCallback((e) => {
    if (disabled || motionDisabled()) return;
    const node = tiltRef.current;
    if (!node) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width - 0.5;  // −0.5 .. 0.5
    const fy = (e.clientY - rect.top) / rect.height - 0.5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      node.style.setProperty('--rx', `${(-fy * maxTilt * 2).toFixed(2)}deg`);
      node.style.setProperty('--ry', `${(fx * maxTilt * 2).toFixed(2)}deg`);
      // unitless pointer fractions — layers multiply these into their own
      // lateral parallax shift (--shift) in CSS
      node.style.setProperty('--mx', fx.toFixed(3));
      node.style.setProperty('--my', fy.toFixed(3));
      node.style.setProperty('--gx', `${((fx + 0.5) * 100).toFixed(1)}%`);
      node.style.setProperty('--gy', `${((fy + 0.5) * 100).toFixed(1)}%`);
      node.style.setProperty('--glare', '1');
    });
  }, [maxTilt, disabled]);

  const onPointerLeave = useCallback(() => {
    const node = tiltRef.current;
    if (!node) return;
    cancelAnimationFrame(frame.current);
    node.style.setProperty('--rx', '0deg');
    node.style.setProperty('--ry', '0deg');
    node.style.setProperty('--mx', '0');
    node.style.setProperty('--my', '0');
    node.style.setProperty('--glare', '0');
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return { tiltRef, onPointerMove, onPointerLeave };
}
