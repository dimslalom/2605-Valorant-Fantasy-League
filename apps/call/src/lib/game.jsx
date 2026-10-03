import { useCallback, useEffect, useMemo, useState } from 'react';
import cards from '../../../../src/data/cards.json';
import { buyPack, callRecord, createCollection, resolveSeries, setCall, swapFee, swapTracked, totalScore } from '../../../../src/engine/collect/game';
import { makeCardLookup } from '../../../../src/engine/shared/cardLookup';
import { fetchPlayers } from './feed';
import { GameContext } from './gameContext';

// The one place the game's state lives: your save (localStorage), the players the feed
// knows (joined to the designed cards), and the actions that change them. Everything is
// local to this browser for now; trading and the leaderboard need accounts later.

const SAVE_KEY = 'opval-save';
const SAVE_VERSION = 1;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
    return raw && raw.v === SAVE_VERSION ? raw.state : null;
  } catch {
    return null;
  }
}

export function GameProvider({ children }) {
  const [feedPlayers, setFeedPlayers] = useState(null);
  const [saved, setSaved] = useState(load);
  const [seed] = useState(() => Math.floor(Math.random() * 1e9));
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetchPlayers().then(list => { if (live) setFeedPlayers(list ?? []); });
    return () => { live = false; };
  }, []);

  // Feed players joined to designed cards by handle + team tag. Only players with a card can be
  // owned (the card is the product), so they form the pool packs draw from.
  const { players, pool } = useMemo(() => {
    const lookup = makeCardLookup(cards);
    const byId = {};
    const entries = [];
    for (const p of feedPlayers ?? []) {
      const card = lookup(p.handle, p.teamTag);
      byId[p.vlrId] = { pid: p.vlrId, handle: p.handle, team: p.teamTag, card };
      if (card) entries.push({ pid: p.vlrId, tier: card.palette });
    }
    return { players: byId, pool: entries };
  }, [feedPlayers]);

  const ready = feedPlayers != null;
  const teamOf = useCallback(pid => players[pid]?.team ?? null, [players]);
  const tierOf = useCallback(pid => players[pid]?.card?.palette ?? 'bronze', [players]);

  // First visit: the starter collection is dealt as soon as the pool is known, derived (not set in
  // an effect) from a seed fixed for this visit, then saved with everything else below.
  const starter = useMemo(() => (ready && pool.length >= 10 ? createCollection({ seed, pool }) : null), [ready, pool, seed]);
  const state = saved ?? starter;

  useEffect(() => {
    if (!state) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, state })); } catch { /* storage blocked: progress will not persist */ }
  }, [state]);

  // Actions compute the next state from the current one OUTSIDE React's updater, so an engine
  // error ("not enough credits") becomes a message instead of a crash.
  const run = useCallback(fn => {
    if (!state) return null;
    try {
      const out = fn(state);
      setSaved(out.state ?? out);
      setError('');
      return out;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }, [state]);

  const actions = useMemo(() => ({
    call: (matchId, call) => run(s => setCall(s, matchId, call)),
    swap: (outPid, inPid) => Boolean(run(s => swapTracked(s, outPid, inPid, tierOf))),
    buy: () => run(s => buyPack(s, pool)),
    reveal: series => run(s => resolveSeries(s, series, { teamOf })),
    resetForTesting: () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } setSaved(null); },
  }), [run, pool, teamOf, tierOf]);

  const value = useMemo(() => ({
    ready, players, pool, state, error, teamOf, tierOf, swapFee,
    score: state ? totalScore(state) : 0,
    record: state ? callRecord(state) : { made: 0, right: 0 },
    ...actions,
  }), [ready, players, pool, state, error, teamOf, tierOf, actions]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
