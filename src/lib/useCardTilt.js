import { useCallback, useEffect, useRef } from 'react';
import { prefersReducedMotion } from './useReducedMotion';
import { seededRestAngle } from './cardPhysics';

const SPRING = 260;
const DAMPING = 24;
const MAX_TILT = 12;
const MAX_ROLL = 12;

function coarsePointer() {
  return typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;
}

export default function useCardTilt({ disabled = false, seed } = {}) {
  const tiltRef = useRef(null);
  const frameRef = useRef(0);
  const previousTimeRef = useRef(0);
  const samplesRef = useRef([]);
  const rollTimerRef = useRef(0);
  const stateRef = useRef({ rx: 0, ry: 0, rz: 0, lift: 0, scale: 1, vx: 0, vy: 0, vz: 0, vl: 0, vs: 0 });
  const targetRef = useRef({ rx: 0, ry: 0, rz: 0, lift: 0, scale: 1 });

  const write = useCallback(() => {
    const node = tiltRef.current;
    if (!node) return;
    const value = stateRef.current;
    node.style.setProperty('--rx', `${value.rx.toFixed(2)}deg`);
    node.style.setProperty('--ry', `${value.ry.toFixed(2)}deg`);
    node.style.setProperty('--rz', `${value.rz.toFixed(2)}deg`);
    node.style.setProperty('--lift', `${value.lift.toFixed(2)}px`);
    node.style.setProperty('--card-scale', value.scale.toFixed(3));
    node.style.setProperty('--ambient-opacity', Math.min(1, Math.abs(value.lift) / 28).toFixed(2));
  }, []);

  const animateToTarget = useCallback(() => {
    if (frameRef.current || prefersReducedMotion()) {
      if (prefersReducedMotion()) {
        Object.assign(stateRef.current, targetRef.current, { vx: 0, vy: 0, vz: 0, vl: 0, vs: 0 });
        write();
      }
      return;
    }
    previousTimeRef.current = performance.now();
    const tick = (now) => {
      const dt = Math.min((now - previousTimeRef.current) / 1000, 0.032);
      previousTimeRef.current = now;
      const state = stateRef.current;
      const target = targetRef.current;
      const channels = [['rx', 'vx'], ['ry', 'vy'], ['rz', 'vz'], ['lift', 'vl'], ['scale', 'vs']];
      let moving = false;
      for (const [position, velocity] of channels) {
        const acceleration = SPRING * (target[position] - state[position]) - DAMPING * state[velocity];
        state[velocity] += acceleration * dt;
        state[position] += state[velocity] * dt;
        if (Math.abs(target[position] - state[position]) > 0.01 || Math.abs(state[velocity]) > 0.02) moving = true;
        else { state[position] = target[position]; state[velocity] = 0; }
      }
      write();
      if (moving) frameRef.current = requestAnimationFrame(tick);
      else frameRef.current = 0;
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [write]);

  const setElevation = useCallback((lift, scale) => {
    targetRef.current.lift = lift;
    targetRef.current.scale = scale;
    animateToTarget();
  }, [animateToTarget]);

  const onPointerMove = useCallback((event) => {
    if (disabled || coarsePointer() || prefersReducedMotion()) return;
    const node = tiltRef.current;
    if (!node) return;
    const rect = event.currentTarget.getBoundingClientRect();
    let fx = (event.clientX - rect.left) / rect.width - 0.5;
    let fy = (event.clientY - rect.top) / rect.height - 0.5;
    const radial = Math.hypot(fx, fy) / Math.SQRT1_2;
    if (radial < 0.05) { fx = 0; fy = 0; }

    const now = performance.now();
    const samples = samplesRef.current;
    samples.push({ x: event.clientX, at: now });
    while (samples.length > 3 || samples[0]?.at < now - 50) samples.shift();
    const first = samples[0];
    const velocityX = first && now > first.at ? (event.clientX - first.x) / (now - first.at) : 0;

    targetRef.current.rx = -fy * MAX_TILT * 2;
    targetRef.current.ry = fx * MAX_TILT * 2;
    targetRef.current.rz = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, -velocityX * 8));
    node.style.setProperty('--mx', fx.toFixed(3));
    node.style.setProperty('--my', fy.toFixed(3));
    node.style.setProperty('--mouse-x', `${((fx + 0.5) * 100).toFixed(2)}%`);
    node.style.setProperty('--mouse-y', `${((fy + 0.5) * 100).toFixed(2)}%`);
    node.style.setProperty('--glare', '1');
    animateToTarget();
    clearTimeout(rollTimerRef.current);
    rollTimerRef.current = setTimeout(() => {
      targetRef.current.rz = 0;
      animateToTarget();
    }, 50);
  }, [animateToTarget, disabled]);

  const onPointerEnter = useCallback(() => {
    if (disabled || coarsePointer()) return;
    setElevation(-16, 1.04);
  }, [disabled, setElevation]);

  const onPointerDown = useCallback(() => {
    if (disabled || coarsePointer()) return;
    setElevation(-28, 1.08);
  }, [disabled, setElevation]);

  const onPointerUp = useCallback(() => {
    if (disabled || coarsePointer()) return;
    setElevation(-16, 1.04);
  }, [disabled, setElevation]);

  const onPointerLeave = useCallback(() => {
    const node = tiltRef.current;
    clearTimeout(rollTimerRef.current);
    samplesRef.current = [];
    Object.assign(targetRef.current, { rx: 0, ry: 0, rz: 0, lift: 0, scale: 1 });
    if (node) {
      node.style.setProperty('--mx', '0');
      node.style.setProperty('--my', '0');
      node.style.setProperty('--mouse-x', '50%');
      node.style.setProperty('--mouse-y', '50%');
      node.style.setProperty('--glare', '0');
    }
    animateToTarget();
  }, [animateToTarget]);

  const onFocus = useCallback(() => !disabled && setElevation(-16, 1.04), [disabled, setElevation]);
  const onBlur = useCallback(() => onPointerLeave(), [onPointerLeave]);

  useEffect(() => {
    tiltRef.current?.style.setProperty('--rest-rotate', `${seededRestAngle(seed)}deg`);
    return () => {
      clearTimeout(rollTimerRef.current);
      cancelAnimationFrame(frameRef.current);
    };
  }, [seed]);

  return { tiltRef, onPointerMove, onPointerEnter, onPointerDown, onPointerUp, onPointerLeave, onFocus, onBlur };
}
