import { applyAutoSubs, autoLineup, validLineup } from './lineup.js';
import { createLeague, settleMatchday, standings } from './league.js';
import { closeMarket, openMarket } from './market.js';
import { scoreLineup } from './scoring.js';

// Drives a replay campaign: one step = close the market, lock lineups, score the
// matchday from real stats, pay out, open the next market.

export const ctxFor = (replay, step) => ({
  players: replay.players,
  values: replay.valuesAt[Math.min(step, replay.valuesAt.length - 1)],
  seriesNext: replay.seriesNext[Math.min(step, replay.seriesNext.length - 1)],
});

const roleOfFn = replay => pid => replay.players[pid].role;

export function startReplay(replay, { seed = 1, humanName = 'You', campaignId = 'replay' } = {}) {
  const ctx = ctxFor(replay, 0);
  let state = createLeague({ seed, campaignId, ctx, humanName, kind: 'replay' });
  state = { ...state, step: 0, status: 'market', totalSteps: replay.matchdays.length };
  return openMarket(state, 'md1', ctx, { replay: true });
}

// A lineup for every manager: the human's draft if it is legal, else the auto pick.
export function lockLineups(state, replay, humanDraft) {
  const ctx = ctxFor(replay, state.step);
  const roleOf = roleOfFn(replay);
  const locked = {};
  for (const m of state.managers) {
    const squad = Object.keys(state.owner).filter(pid => state.owner[pid] === m.id).map(Number);
    const auto = autoLineup(squad, { epOf: pid => ctx.values[pid].ep, roleOf, seriesOf: pid => ctx.seriesNext[pid] ?? 1 });
    if (m.kind === 'human' && humanDraft && validLineup(humanDraft, squad, roleOf).ok) {
      const bench = squad.filter(pid => !Object.values(humanDraft.slots).includes(pid));
      locked[m.id] = { slots: humanDraft.slots, bench: humanDraft.bench?.length ? humanDraft.bench.filter(p => bench.includes(p)).concat(bench.filter(p => !humanDraft.bench.includes(p))) : bench, captain: humanDraft.captain ?? auto.captain };
    } else {
      locked[m.id] = auto;
    }
  }
  return locked;
}

export function playMatchday(state, replay, humanDraft) {
  if (state.status === 'done') return { state, report: null, results: null, md: null, locked: null };
  const md = replay.matchdays[state.step];
  const closed = closeMarket(state, ctxFor(replay, state.step));
  const locked = lockLineups(closed.state, replay, humanDraft);
  const settled = settleMatchday(closed.state, md.id, {
    lockedLineups: locked,
    matchdayPoints: md.points,
    applyAutoSubs,
    scoreLineup,
    mapsPlayedOf: pid => md.mapsPlayed.get(pid) ?? 0,
  });
  let next = settled.state;
  next.lineups = { ...next.lineups, [md.id]: locked };
  next.step = state.step + 1;
  if (next.step >= replay.matchdays.length) {
    next.status = 'done';
  } else {
    next = openMarket(next, `md${next.step + 1}`, ctxFor(replay, next.step), { replay: true });
  }
  return { state: next, report: closed.report, results: settled.results, md, locked };
}

export { standings };
