import { useState, useSyncExternalStore } from 'react';
import CardThumb from '../components/CardThumb';
import Fan from '../components/Fan';
import PackOpen from '../components/PackOpen';
import Sheet from '../components/Sheet';
import { useGame } from '../lib/gameContext';
import { ECONOMY } from '../../../../src/engine/collect/rules';

const TIERS = ['icon', 'gold', 'silver', 'bronze'];

// Storage plus the Tracked ten. Only Tracked cards earn points, so the whole game is
// choosing which ten to Track; swapping costs credits after the first few free ones.
const WIDE = '(min-width: 700px)';
const useWide = () => useSyncExternalStore(cb => { const m = matchMedia(WIDE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); }, () => matchMedia(WIDE).matches);

export default function Collection() {
  const { ready, state, players, tierOf, swapFee, swap, buy, error } = useGame();
  const [pickedOut, setPickedOut] = useState(null);   // a Tracked card to remove
  const [pickedIn, setPickedIn] = useState(null);     // a stored card to bring in
  const [from, setFrom] = useState(null);             // which side the swap started from: 'tracked' or 'storage'
  const [tier, setTier] = useState('all');            // storage filter inside the swap sheet
  const [opened, setOpened] = useState(null);         // cards from the last pack
  const wide = useWide();

  if (!ready) return <section><h1>Cards</h1><p className="note">Loading cards</p></section>;
  if (!state) return <section><h1>Cards</h1><p className="note" role="alert">Cards are unavailable right now. Try again in a few minutes.</p></section>;

  const trackedSet = new Set(state.tracked);
  const storage = state.collection.filter(pid => !trackedSet.has(pid));
  const free = state.freeSwaps > 0;
  const fee = pickedIn != null ? (free ? 0 : swapFee(tierOf(pickedIn))) : 0;

  const close = () => { setPickedOut(null); setPickedIn(null); setFrom(null); setTier('all'); };
  const confirmSwap = () => { if (swap(pickedOut, pickedIn)) close(); };
  const startFrom = (side, pid) => {
    setFrom(side);
    if (side === 'tracked') setPickedOut(pid); else setPickedIn(pid);
  };
  const openPack = () => {
    const result = buy();
    if (result) setOpened(result.cards);
  };

  const cardOf = pid => players[pid]?.card;
  // The Tracked ten as a hand of cards: one arc on wide screens, two arcs of five on a phone
  // so every card stays big enough to tap.
  const hand = state.tracked.filter(cardOf).sort((x, y) => cardOf(y).rating - cardOf(x).rating);
  const rows = wide ? [hand] : [hand.slice(0, 5), hand.slice(5)];
  const rating = hand.length ? Math.round(hand.reduce((t, pid) => t + cardOf(pid).rating, 0) / hand.length) : '-';
  const freePacks = state.freePacks ?? 0;
  const canOpen = freePacks > 0 || state.credits >= ECONOMY.packCost;
  const packButton = <button className="primary" onClick={openPack} disabled={!canOpen}>{freePacks ? 'Open free pack' : `Open pack ${ECONOMY.packCost} CR`}</button>;
  const byRating = (x, y) => cardOf(y).rating - cardOf(x).rating;
  // Team rating if this swap went through, so the sheet can show what it changes.
  const ratingAfter = pickedOut != null && pickedIn != null
    ? Math.round(hand.reduce((t, pid) => t + cardOf(pid === pickedOut ? pickedIn : pid).rating, 0) / hand.length)
    : null;
  const tiersHeld = TIERS.filter(t => storage.some(pid => cardOf(pid)?.palette === t));
  const candidates = from === 'tracked'
    ? storage.filter(pid => cardOf(pid) && (tier === 'all' || cardOf(pid).palette === tier)).sort(byRating)
    : [...hand];
  const anchor = from === 'tracked' ? pickedOut : pickedIn;
  const chosen = from === 'tracked' ? pickedIn : pickedOut;
  const choose = pid => (from === 'tracked' ? setPickedIn : setPickedOut)(chosen === pid ? null : pid);

  return (
    <section>
      <h1>Cards</h1>

      {/* Same overview row as Matches: each count big in the display type with its word beside it. */}
      <div className="matches-overview cards-overview" aria-label="Team status">
        <span><strong className="cards-rating">{rating}</strong> team rating</span>
        <span><strong>{state.freeSwaps}</strong> free swap{state.freeSwaps === 1 ? '' : 's'}</span>
        <span><strong>{storage.length}</strong> in storage</span>
      </div>
      {rows.map((row, r) => (
        <Fan key={r} pids={row} cardOf={cardOf} scale={wide ? 0.3 : 0.26} arc={wide ? 1.4 : 2.5} delay={r * 250} picked={pickedOut} onPick={pid => startFrom('tracked', pid)} />
      ))}

      <div className="shelf-head">
        <h2 className="section">Storage</h2>
        <div className="shelf-pack">
          {freePacks > 0 ? <span>{freePacks} free pack{freePacks === 1 ? '' : 's'} left</span> : state.credits < ECONOMY.packCost && <span>{ECONOMY.packCost - state.credits} more credits</span>}
          {packButton}
        </div>
      </div>
      {storage.length === 0 && <p className="note">{state.collection.length ? 'Extra cards from packs land here.' : 'Open your free packs to build your team.'}</p>}
      {TIERS.map(tier => {
        const shelf = storage.filter(pid => cardOf(pid)?.palette === tier).sort((x, y) => cardOf(y).rating - cardOf(x).rating);
        return shelf.length > 0 && (
          <div key={tier} className="shelf">
            <h3>{tier}<span>{shelf.length}</span></h3>
            <div className="grid">
              {shelf.map(pid => (
                <div key={pid} className="slot">
                  <CardThumb card={cardOf(pid)} scale={0.26} onClick={() => startFrom('storage', pid)} />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {opened && <PackOpen key={state.packsOpened} pids={opened} cardOf={cardOf} onDone={() => setOpened(null)} />}

      {error && <p className="error" role="alert">{error}</p>}

      {/* The swap, EA FC style: start from either side, pick the other from a grid of cards, and
          the bar at the bottom shows what changes (who, team rating, cost) before you confirm. */}
      <Sheet open={from != null} onClose={close} title={from === 'tracked' ? `Swap out ${players[anchor]?.handle}` : `Swap in ${players[anchor]?.handle}`}>
        {from === 'tracked' && storage.length > 0 && tiersHeld.length > 1 && (
          <div className="tier-switch" role="group" aria-label="Tier" style={{ '--n': tiersHeld.length + 1 }}>
            {['all', ...tiersHeld].map(t => (
              <button key={t} type="button" className={tier === t ? 'primary' : undefined} aria-pressed={tier === t} onClick={() => setTier(t)}>{t}</button>
            ))}
          </div>
        )}
        {candidates.length > 0 ? (
          <div className="swap-grid">
            {candidates.map(pid => (
              <div key={pid} className="slot" data-picked={chosen === pid}>
                <CardThumb card={cardOf(pid)} scale={0.22} selected={chosen === pid} onClick={() => choose(pid)} />
              </div>
            ))}
          </div>
        ) : (
          <div className="swap-empty">
            <div className="swap-wells" aria-hidden="true"><i /><i /><i /></div>
            {packButton}
          </div>
        )}
        {pickedOut != null && pickedIn != null && (
          <div className="swap-commit">
            <div className="swap-facts">
              <span className="swap-plan">
                <span className="swap-side"><small>Out</small><b>{players[pickedOut].handle}</b></span>
                <span className="swap-arrow" aria-hidden="true" />
                <span className="swap-side"><small>In</small><b>{players[pickedIn].handle}</b></span>
              </span>
              <span className="swap-rating" data-dir={Math.sign(ratingAfter - rating)}>
                <small>Team</small>
                <b>{rating}<span className="swap-arrow" aria-hidden="true" />{ratingAfter}</b>
              </span>
              <span className="swap-cost" data-free={free}>{free ? 'Free' : `${fee} CR`}</span>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="primary big" onClick={confirmSwap}>Confirm swap</button>
          </div>
        )}
      </Sheet>
    </section>
  );
}
