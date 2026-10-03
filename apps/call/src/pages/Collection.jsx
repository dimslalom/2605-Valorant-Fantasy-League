import { useState } from 'react';
import CardThumb from '../components/CardThumb';
import { useGame } from '../lib/gameContext';
import { ECONOMY, TRACKED_MAX } from '../../../../src/engine/collect/rules';

// Storage plus the Tracked ten. Only Tracked cards earn points, so the whole game is
// choosing which ten to Track; swapping costs credits after the first few free ones.
export default function Collection() {
  const { ready, state, players, tierOf, swapFee, swap, buy, error } = useGame();
  const [pickedOut, setPickedOut] = useState(null);   // a Tracked card to remove
  const [pickedIn, setPickedIn] = useState(null);     // a stored card to bring in
  const [opened, setOpened] = useState(null);         // cards from the last pack

  if (!ready || !state) return <section><h1>Collection</h1><p className="note">Dealing your starter cards</p></section>;

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

  return (
    <section>
      <h1>Collection</h1>

      <div className="stats">
        <div><span>Credits</span><strong>{state.credits}</strong></div>
        <div><span>Tracked</span><strong>{state.tracked.length}/{TRACKED_MAX}</strong></div>
        <div><span>Free swaps</span><strong>{state.freeSwaps}</strong></div>
        <div><span>Cards</span><strong>{state.collection.length}</strong></div>
      </div>

      <p className="note">Only your Tracked cards earn points when they play. To change who you Track, tap a Tracked card, then a card from storage.</p>

      <h2 className="section">Tracked</h2>
      <div className="grid">
        {state.tracked.map(pid => cardOf(pid) && (
          <div key={pid} className="slot" data-picked={pickedOut === pid}>
            <CardThumb card={cardOf(pid)} scale={0.26} selected={pickedOut === pid} onClick={() => setPickedOut(pickedOut === pid ? null : pid)} />
          </div>
        ))}
      </div>

      <h2 className="section">Storage ({storage.length})</h2>
      {storage.length === 0 && <p className="note">Nothing in storage yet. Open a pack to add cards.</p>}
      <div className="grid">
        {storage.map(pid => cardOf(pid) && (
          <div key={pid} className="slot" data-picked={pickedIn === pid}>
            <CardThumb card={cardOf(pid)} scale={0.26} selected={pickedIn === pid} onClick={() => setPickedIn(pickedIn === pid ? null : pid)} />
          </div>
        ))}
      </div>

      <div className="pack">
        <button className="primary" onClick={openPack} disabled={state.credits < ECONOMY.packCost}>
          Open a pack ({ECONOMY.packCost} credits)
        </button>
        {state.credits < ECONOMY.packCost && <span className="note">You earn credits from points. {ECONOMY.packCost - state.credits} more for a pack.</span>}
      </div>

      {opened && (
        <div className="opened" role="status">
          <h2 className="section">New cards</h2>
          <div className="grid">{opened.map(pid => cardOf(pid) && <CardThumb key={pid} card={cardOf(pid)} scale={0.26} />)}</div>
          <button className="secondary" onClick={() => setOpened(null)}>Close</button>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      {(pickedOut != null || pickedIn != null) && (
        <div className="swapbar" role="status">
          {pickedOut != null && pickedIn != null ? (
            <>
              <span>Swap <strong>{players[pickedOut].handle}</strong> out, <strong>{players[pickedIn].handle}</strong> in. {free ? 'Free swap.' : `Costs ${fee} credits.`}</span>
              <button className="primary" onClick={confirmSwap}>Confirm</button>
            </>
          ) : (
            <span>{pickedOut != null ? 'Now pick a card from storage to bring in.' : 'Now pick a Tracked card to take out.'}</span>
          )}
          <button className="secondary" onClick={() => { setPickedOut(null); setPickedIn(null); }}>Cancel</button>
        </div>
      )}
    </section>
  );
}
