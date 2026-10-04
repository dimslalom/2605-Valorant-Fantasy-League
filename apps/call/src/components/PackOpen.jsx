import { useEffect, useRef, useState } from 'react';
import { m } from 'motion/react';
import CardThumb from './CardThumb';
import PackTear from '../../../../src/components/PackTear';
import { playUiSound } from '../../../../src/lib/gameAudio';

// The pack-open moment, built on what makes Pokemon TCG Pocket and Balatro packs feel good:
//  1. You open it yourself (drag the foil), so the pull feels earned, not delivered.
//  2. Cards come out face down and you turn each one, so every card is its own small bet.
//  3. Worst first, best last: the stack builds toward the hit instead of spending it up front.
//  4. A hit announces itself: a gold card rattles before it turns, then lands with a shake.
//  5. Every turn climbs a note, so a pack plays as a rising phrase, and the shake scales with the pull.
//  6. Repeats stay cheap: Space/tap drives everything, and Reveal all skips to the result.

const HIT = new Set(['gold', 'icon']);
const RATTLE_MS = 560;
const PEEK = 0.22;   // how far the edge lifts, as a share of the card width: shows the tier, not the rating
const TAP = 6;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function PackOpen({ pids, cardOf, onDone }) {
  const ref = useRef(null);
  const stageRef = useRef(null);
  const busy = useRef(false);
  const timers = useRef([]);
  const press = useRef(null);   // an edge-peek drag in progress
  const [order] = useState(() => [...pids].filter(cardOf).sort((a, b) => cardOf(a).rating - cardOf(b).rating));
  const [phase, setPhase] = useState('pack');   // pack -> stack -> done
  const [i, setI] = useState(0);                 // the card on top of the stack
  const [up, setUp] = useState(false);           // is it turned?
  const [rattling, setRattling] = useState(false);
  const [big] = useState(() => matchMedia('(min-width: 700px)').matches);

  // Focus the dialog itself, not the pack, so opening by tap does not draw a focus ring on the art.
  useEffect(() => { if (!ref.current.open) { ref.current.showModal(); ref.current.focus(); } }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => { if (phase === 'stack') stageRef.current?.querySelector('.pk-stack')?.focus(); }, [phase]);

  const shake = (px, deg = 0) => {
    if (still()) return;
    stageRef.current?.animate(
      [0, -1, 0.8, -0.6, 0.3, 0].map(k => ({ transform: `translate(${k * px}px, ${-k * px * 0.5}px) rotate(${k * deg}deg)` })),
      { duration: 160 + px * 40, easing: 'ease-out' },
    );
  };

  const turn = () => {
    const tier = cardOf(order[i]).palette;
    const land = () => {
      setRattling(false);
      setUp(true);
      busy.current = false;
      if (HIT.has(tier)) {
        playUiSound('jackpot');
        shake(8, 1);
        if (!still()) stageRef.current?.querySelector('.pk-flash')?.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });
      } else {
        playUiSound('reveal', i);
        shake(tier === 'silver' ? 3 : 2);
      }
    };
    if (HIT.has(tier) && !still()) {
      busy.current = true;
      setRattling(true);
      timers.current = [0, 140, 260, 360, 440, 500].map(t => setTimeout(() => playUiSound('rattle'), t));
      timers.current.push(setTimeout(land, RATTLE_MS));
    } else land();
  };

  // Edge peek (Pokemon TCG Pocket's border check): drag a face-down card sideways and its right edge
  // lifts, showing a strip of the front. Let go to drop it back; pull it all the way to turn it.
  const topCard = () => stageRef.current?.querySelector('.pk-card:last-child');
  const peekDown = e => {
    if (e.button !== 0 || up || busy.current) return;
    press.current = { x: e.clientX, max: 400 * scale * PEEK, p: 0, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const peekMove = e => {
    const pr = press.current;
    if (!pr) return;
    const dx = Math.abs(e.clientX - pr.x);
    if (dx > TAP) pr.moved = true;
    pr.p = Math.min(pr.max, dx * 0.8);
    const el = topCard();
    if (!el) return;
    el.dataset.peeking = 'true';
    el.style.setProperty('--p', `${pr.p}px`);
  };
  const peekUp = (cancelled = false) => {
    const pr = press.current;
    if (!pr) return;
    press.current = null;
    const el = topCard();
    if (!el) return;
    el.dataset.peeking = 'false';
    el.style.setProperty('--p', '0px');
    if (pr.moved) {
      press.current = { swallowClick: true };
      setTimeout(() => { press.current = null; }, 0);
      if (!cancelled && pr.p >= pr.max * 0.98) turn();
    }
  };

  const advance = () => {
    if (press.current?.swallowClick) return;
    if (busy.current || phase !== 'stack') return;
    if (!up) return turn();
    setUp(false);
    if (i + 1 >= order.length) setPhase('done');
    else setI(i + 1);
  };

  const revealAll = () => { timers.current.forEach(clearTimeout); busy.current = false; setRattling(false); setI(order.length); setPhase('done'); };

  const scale = big ? 0.55 : 0.48;
  const tray = order.slice(0, phase === 'done' ? 0 : i);
  const best = order[order.length - 1];

  return (
    <dialog ref={ref} className="pk" tabIndex={-1} onClose={onDone} aria-label="Open pack">
      <div className="pk-top">
        <span>{phase === 'done' ? 'Pack complete' : 'New pack'}</span>
        {phase === 'stack' && <button className="ghost" onClick={revealAll}>Reveal all</button>}
      </div>

      <div ref={stageRef} className="pk-stage" data-phase={phase}>
        <div className="pk-flash" aria-hidden="true" />

        {phase === 'pack' && (
          <div className="pk-pack">
            <PackTear interactive onTorn={() => { playUiSound('impact'); setPhase('stack'); }} frontSrc="/assets/pack/OpVAL-Front.png" topSrc="/assets/pack/OpVAL-Top.png" insideSrc={null} />
          </div>
        )}

        {phase === 'stack' && (
          <div className="pk-stack" role="button" tabIndex={0} aria-label={up ? 'Next card' : 'Turn the card'} data-busy={rattling} aria-busy={rattling} onClick={advance} onPointerDown={peekDown} onPointerMove={peekMove} onPointerUp={() => peekUp()} onPointerCancel={() => peekUp(true)} onDragStart={e => e.preventDefault()}
            onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance(); } }}
            style={{ width: 400 * scale, height: 580 * scale }}>
            {order.slice(i).reverse().map((pid, k, rest) => {
              const depth = rest.length - 1 - k;   // 0 = top card
              const top = depth === 0;
              return (
                <m.div key={pid} layoutId={`pk-${pid}`} className="pk-card" data-up={top && up} data-rattle={top && rattling} data-tier={cardOf(pid).palette}
                  style={{ zIndex: 10 - depth, '--dx': `${depth * 4}px`, '--dy': `${depth * 5}px`, '--dr': `${(depth % 2 ? 1 : -1) * depth * 1.5}deg` }}>
                  <div className="pk-face"><CardThumb card={cardOf(pid)} scale={scale} /></div>
                  <div className="pk-back" />
                  {top && !up && <div className="pk-peek" aria-hidden="true"><CardThumb card={cardOf(pid)} scale={scale} /></div>}
                </m.div>
              );
            })}
          </div>
        )}

        {phase === 'done' && (
          <div className="pk-done">
            {[...order].reverse().map(pid => (
              <m.div key={pid} layoutId={`pk-${pid}`} className="pk-result" data-best={pid === best}>
                <CardThumb card={cardOf(pid)} scale={pid === best ? (big ? 0.38 : 0.34) : (big ? 0.3 : 0.24)} />
              </m.div>
            ))}
          </div>
        )}
      </div>

      <div className="pk-foot">
        {phase === 'pack' && <p className="pk-hint">Drag the top of the pack to tear it open</p>}
        {phase === 'stack' && (
          <div className="pk-tray" aria-label="Revealed">
            {order.map((pid, k) => (
              <div key={pid} className="pk-slot">
                {tray.includes(pid) && <m.div layoutId={`pk-${pid}`}><CardThumb card={cardOf(pid)} scale={0.11} /></m.div>}
                {k === i && <span className="pk-now" />}
              </div>
            ))}
          </div>
        )}
        {phase === 'stack' && <p className="pk-hint">{up ? 'Tap for the next card' : 'Tap to turn it, drag the edge to peek'}</p>}
        {phase === 'done' && <button className="primary big" autoFocus onClick={() => ref.current.close()}>Add to collection</button>}
      </div>
    </dialog>
  );
}
