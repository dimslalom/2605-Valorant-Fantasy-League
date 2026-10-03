import { resolveCall } from './calls.js';
import { ECONOMY, TRACKED_MAX } from './rules.js';
import { openPack, starterCollection } from './packs.js';
import { scoreSeries } from '../fantasy/scoring.js';

// One player's collection game. State is plain data (saved as JSON):
//   collection: pids you own          tracked: up to 10 of them that score points
//   credits, streak, packsOpened      calls: { [matchId]: call }
//   history: one entry per resolved matchday
// The feed (replay/live) is passed in, never stored.

export function createCollection({ seed, pool }) {
  const collection = starterCollection(seed, pool);
  return {
    v: 1,
    seed,
    collection,
    tracked: collection.slice(0, TRACKED_MAX),
    credits: 0,
    streak: 0,
    packsOpened: 0,
    calls: {},
    history: [],
    freeSwaps: 3,
  };
}

export const swapFee = tier => ECONOMY.swapBase + (ECONOMY.swapByTier[tier] ?? 0);

// Swap a Tracked player for another card you own. The first few swaps are free;
// after that it costs credits, more for better cards. Returns a new state.
export function swapTracked(state, outPid, inPid, tierOf) {
  if (!state.tracked.includes(outPid)) throw new Error('not tracked');
  if (!state.collection.includes(inPid)) throw new Error('you do not own that card');
  if (state.tracked.includes(inPid)) throw new Error('already tracked');
  const free = state.freeSwaps > 0;
  const fee = free ? 0 : swapFee(tierOf(inPid));
  if (state.credits < fee) throw new Error('not enough credits');
  return {
    ...state,
    tracked: state.tracked.map(p => (p === outPid ? inPid : p)),
    credits: state.credits - fee,
    freeSwaps: free ? state.freeSwaps - 1 : state.freeSwaps,
  };
}

export function buyPack(state, pool) {
  if (state.credits < ECONOMY.packCost) throw new Error('not enough credits');
  const { cards, refund } = openPack(state.seed, state.packsOpened, pool, state.collection);
  return {
    state: {
      ...state,
      collection: [...state.collection, ...cards],
      credits: state.credits - ECONOMY.packCost + refund,
      packsOpened: state.packsOpened + 1,
    },
    cards,
    refund,
  };
}

export function setCall(state, matchId, call) {
  return { ...state, calls: { ...state.calls, [matchId]: call } };
}

// Resolve a matchday against its finished series. Returns { state, report }.
// `md.matches` are the series; calls you did not make simply score nothing and
// do not break your streak (a skipped series is not a wrong one).
export function resolveMatchday(state, md, { teamOf }) {
  let streak = state.streak;
  const calls = [];
  let callPoints = 0;
  let trackedPoints = 0;
  const trackedLines = new Map();

  for (const series of md.matches) {
    const points = scoreSeries(series);
    for (const pid of state.tracked) {
      const entry = points.get(pid);
      if (!entry) continue;
      trackedPoints += entry.total;
      trackedLines.set(pid, (trackedLines.get(pid) ?? 0) + entry.total);
    }
    const call = state.calls[series.matchId];
    if (!call || call.winner == null) continue;
    const result = resolveCall(call, series, points, { tracked: state.tracked, teamOf, streak });
    streak = result.winnerRight ? streak + 1 : 0;
    callPoints += result.total;
    calls.push({ matchId: series.matchId, call, result });
  }

  const report = {
    mdId: md.id,
    callPoints,
    trackedPoints,
    total: callPoints + trackedPoints,
    callsMade: calls.length,
    callsRight: calls.filter(c => c.result.winnerRight).length,
    calls,
    trackedLines: [...trackedLines.entries()].map(([pid, total]) => ({ pid, total })).sort((a, b) => b.total - a.total),
  };
  return {
    state: {
      ...state,
      streak,
      credits: state.credits + report.total * ECONOMY.creditsPerPoint,
      history: [...state.history, { mdId: md.id, callPoints, trackedPoints, callsMade: report.callsMade, callsRight: report.callsRight }],
    },
    report,
  };
}

export const totalScore = state => state.history.reduce((sum, h) => sum + h.callPoints + h.trackedPoints, 0);
