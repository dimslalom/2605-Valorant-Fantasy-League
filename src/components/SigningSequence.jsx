import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PlayerCard from './PlayerCard';
import TacticalButton from './TacticalButton';
import { flyTo } from '../lib/flight';
import { bump, gate } from '../lib/anime';
import styles from './SigningSequence.module.css';

// Transfer market / prospect signing, played out on the manage screen rather
// than routed through the pack-open flow: the cost pays out of the pack
// bank, a SIGNED plate lands, then the card itself arcs into the dock (or
// asks which chip to replace first). Nothing about the signing - packs
// spent, the squad, the news item - commits until the card actually lands
// (see PerfectRun's commitSigning); cancelling at any point before that
// charges nothing, which is also the fix for the old pack-phase route where
// "Keep squad" could keep packs already spent on a card never placed.
export default function SigningSequence({
  card, cost, picks, openSlot, onCommit, onCancel, reducedMotion, runSpeed,
}) {
  // pay -> stamp -> choose (only if the squad is full) -> flying
  const [step, setStep] = useState(cost > 0 ? 'pay' : 'stamp');
  const stageRef = useRef(null);
  const stampRef = useRef(null);
  const activeRef = useRef(null); // whatever's in flight right now - skip completes it

  const { instant } = gate({ reducedMotion, runSpeed });

  // Pay: `cost` pack tokens leave the bank and land on the staged card.
  useEffect(() => {
    if (step !== 'pay') return undefined;
    const bankEl = document.querySelector('[data-bank="pack"]');
    const stageEl = stageRef.current;
    if (!bankEl || !stageEl || cost <= 0) { setStep('stamp'); return undefined; }
    let landed = 0;
    let cancelled = false;
    const flights = Array.from({ length: cost }, (_, index) => flyTo(bankEl, stageEl, {
      scaleTo: 0.5, rotate: index % 2 ? 8 : -8, delay: index * 70,
      reducedMotion, runSpeed,
      onLand: () => {
        landed += 1;
        if (cancelled) return;
        bump(bankEl);
        if (landed >= cost) setStep('stamp');
      },
    }));
    activeRef.current = { complete: () => flights.forEach(f => f.complete()) };
    return () => { cancelled = true; activeRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Stamp: a beat with the SIGNED plate up, then straight to placement.
  useEffect(() => {
    if (step !== 'stamp') return undefined;
    const next = openSlot ? 'flying' : 'choose';
    const timer = setTimeout(() => setStep(next), instant ? 0 : 520);
    activeRef.current = { complete: () => { clearTimeout(timer); setStep(next); } };
    return () => clearTimeout(timer);
  }, [step, openSlot, instant]);

  function chooseTarget(targetId) {
    setStep({ kind: 'flying', targetId });
  }

  const flyingTargetId = typeof step === 'object' && step.kind === 'flying' ? step.targetId : undefined;
  const isFlying = flyingTargetId !== undefined || step === 'flying';

  // Fly in: to the open slot, or to whichever chip the player just picked.
  useEffect(() => {
    if (!isFlying) return undefined;
    const targetId = flyingTargetId ?? null;
    const stageEl = stageRef.current;
    const targetEl = targetId === null
      ? document.querySelector(`[data-empty-slot="${picks.length}"]`)
      : document.querySelector(`[data-chip-slot][data-card-id="${targetId}"]`);
    if (!stageEl || !targetEl) { onCommit(targetId); return undefined; }
    const flight = flyTo(stageEl, targetEl, {
      scaleTo: 0.9, reducedMotion, runSpeed,
      onLand: () => onCommit(targetId),
    });
    activeRef.current = flight;
    return () => { activeRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFlying, flyingTargetId]);

  function skip() {
    activeRef.current?.complete();
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); skip(); }
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canCancel = step === 'pay' || step === 'stamp' || step === 'choose';

  return createPortal(
    <div className={styles.backdrop} onClick={skip} role="dialog" aria-modal="true" aria-label={`Signing ${card.player}`}>
      <div className={styles.stage} onClick={(e) => e.stopPropagation()}>
        <div ref={stageRef} className={styles.cardStage} data-swap-incoming="true">
          <PlayerCard card={card} displayScale={0.5} canDrag={false} />
          {step === 'stamp' && (
            <span ref={stampRef} className={styles.stamp} aria-hidden="true">SIGNED</span>
          )}
        </div>

        {step === 'choose' && (
          <div className={styles.choose} role="group" aria-label={`Choose who ${card.player} replaces`}>
            <b className={styles.chooseLabel}>Replace who?</b>
            <div className={styles.chooseList}>
              {picks.map(p => (
                <TacticalButton key={p.id} className={styles.secondary} onClick={() => chooseTarget(p.id)}>
                  {p.player}
                </TacticalButton>
              ))}
            </div>
          </div>
        )}

        {canCancel && (
          <TacticalButton className={styles.cancel} onClick={onCancel}>Cancel</TacticalButton>
        )}
      </div>
    </div>,
    document.body,
  );
}
