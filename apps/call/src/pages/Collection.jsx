import { useState, useSyncExternalStore } from 'react';
import CardThumb from '../components/CardThumb';
import Fan from '../components/Fan';
import PackOpen from '../components/PackOpen';
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
  const [opened, setOpened] = useState(null);         // cards from the last pack
  const wide = useWide();

  if (!ready) return <section><h1>Cards</h1><p className="note">Dealing your starter cards</p></section>;
  // Loaded, but too few players with cards to deal a starter hand (the player feed is down).
  if (!state) return <section><h1>Cards</h1><p className="note" role="alert">Cards are unavailable right now. Try again in a few minutes.</p></section>;

  const trackedSet = new Set(state.tracked);
  const storage = state.collection.filter(pid => !trackedSet.has(pid));
  const free = state.freeSwaps > 0;
  const fee = pickedIn != null ? (free ? 0 : swapFee(tierOf(pickedIn))) : 0;

  const confirmSwap = () => {
    if (swap(pickedOut, pickedIn)) { setPickedOut(null); setPickedIn(null); }
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
  const rating = hand.length ? Math.round(hand.reduce((t, pid) => t + cardOf(pid).rating, 0) / hand.length) : 0;

  return (
    <section>
      <h1>Cards</h1>

      <div className="hand-head">
        <strong>{rating}</strong>
        <span>Team rating</span>
        <p>{state.freeSwaps > 0 ? `${state.freeSwaps} free swap${state.freeSwaps === 1 ? '' : 's'} left` : 'Swaps now cost credits'}</p>
      </div>
      {rows.map((row, r) => (
        <Fan key={r} pids={row} cardOf={cardOf} scale={wide ? 0.3 : 0.26} arc={wide ? 1.4 : 2.5} delay={r * 250} picked={pickedOut} onPick={pid => setPickedOut(pickedOut === pid ? null : pid)} />
      ))}

      <div className="shelf-head">
        <h2 className="section">Storage</h2>
        <div className="shelf-pack">
          {state.credits < ECONOMY.packCost && <span>{ECONOMY.packCost - state.credits} more credits</span>}
          <button className="primary" onClick={openPack} disabled={state.credits < ECONOMY.packCost}>Open pack {ECONOMY.packCost} CR</button>
        </div>
      </div>
      {storage.length === 0 && <p className="note">Empty. Cards from packs land here.</p>}
      {TIERS.map(tier => {
        const shelf = storage.filter(pid => cardOf(pid)?.palette === tier).sort((x, y) => cardOf(y).rating - cardOf(x).rating);
        return shelf.length > 0 && (
          <div key={tier} className="shelf">
            <h3>{tier}<span>{shelf.length}</span></h3>
            <div className="grid">
              {shelf.map(pid => (
                <div key={pid} className="slot" data-picked={pickedIn === pid}>
                  <CardThumb card={cardOf(pid)} scale={0.26} selected={pickedIn === pid} onClick={() => setPickedIn(pickedIn === pid ? null : pid)} />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {opened && <PackOpen key={state.packsOpened} pids={opened} cardOf={cardOf} onDone={() => setOpened(null)} />}

      {error && <p className="error" role="alert">{error}</p>}

      {(pickedOut != null || pickedIn != null) && (
        <div className="swapbar" role="status">
          {pickedOut != null && pickedIn != null ? (
            <>
              <span className="swap-plan">
                <span className="swap-side"><small>Out</small><b>{players[pickedOut].handle}</b></span>
                <span className="swap-arrow" aria-hidden="true" />
                <span className="swap-side"><small>In</small><b>{players[pickedIn].handle}</b></span>
                <span className="swap-cost" data-free={free}>{free ? 'Free' : `${fee} CR`}</span>
              </span>
              <button className="primary" onClick={confirmSwap}>Confirm</button>
            </>
          ) : (
            <span>{pickedOut == null ? 'Now pick a Tracked card to take out.' : storage.length ? 'Now pick a card from storage to bring in.' : 'Storage is empty. Open a pack to get cards to swap in.'}</span>
          )}
          <button className="secondary" onClick={() => { setPickedOut(null); setPickedIn(null); }}>Cancel</button>
        </div>
      )}
    </section>
  );
}
