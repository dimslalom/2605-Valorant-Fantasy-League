import { useCallback, useEffect, useRef } from 'react';
import { prefersReducedMotion } from './useReducedMotion';

const SPRING = 220;
const DAMPING = 18;
const MAX_LEAN = 14; // degrees
const SENSITIVITY = 0.6; // deg of lean per px of scroll delta

// Cards on a scrolled shelf lean into their own inertia - scroll left and
// they swing left, as if the row were a physical surface sliding out from
// under them. Same critically-damped spring shape as useCardTilt, but a
// single channel (angle) driven by scrollLeft velocity instead of pointer
// position, and the target itself decays back to flat each frame rather
// than being reset on pointer-leave: the lean is a momentary kick from
// scrolling, not a state the shelf holds.
//
// Writes a `--lean` custom property onto the scroll container itself so any
// descendant can read `rotate(var(--lean, 0deg))` - nothing here assumes
// what's inside the shelf.
export default function useScrollLean(scrollRef) {
  const frameRef = useRef(0);
  const previousTimeRef = useRef(0);
  const stateRef = useRef({ angle: 0, velocity: 0 });
  const targetRef = useRef(0);
  const lastScrollLeftRef = useRef(0);

  const write = useCallback(() => {
    scrollRef.current?.style.setProperty('--lean', `${stateRef.current.angle.toFixed(2)}deg`);
  }, [scrollRef]);

  const animate = useCallback(() => {
    if (frameRef.current) return;
    if (prefersReducedMotion()) {
      stateRef.current = { angle: 0, velocity: 0 };
      targetRef.current = 0;
      write();
      return;
    }
    previousTimeRef.current = performance.now();
    const tick = (now) => {
      const dt = Math.min((now - previousTimeRef.current) / 1000, 0.032);
      previousTimeRef.current = now;
      const state = stateRef.current;
      const target = targetRef.current;
      const acceleration = SPRING * (target - state.angle) - DAMPING * state.velocity;
      state.velocity += acceleration * dt;
      state.angle += state.velocity * dt;
      targetRef.current *= 0.9;
      write();
      const settled = Math.abs(targetRef.current - state.angle) < 0.01 && Math.abs(state.velocity) < 0.02;
      if (settled) {
        state.angle = 0;
        state.velocity = 0;
        targetRef.current = 0;
        write();
        frameRef.current = 0;
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [write]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    lastScrollLeftRef.current = el.scrollLeft;
    const onScroll = () => {
      const delta = el.scrollLeft - lastScrollLeftRef.current;
      lastScrollLeftRef.current = el.scrollLeft;
      targetRef.current = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, delta * SENSITIVITY));
      animate();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frameRef.current);
    };
  }, [scrollRef, animate]);
}
