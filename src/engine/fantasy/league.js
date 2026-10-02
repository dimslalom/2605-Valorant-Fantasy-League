import { ECONOMY, PERSONALITIES, SLOTS } from './constants.js';
import { rngFor, shuffle } from './rng.js';

// League state: you plus seven AI managers, one owner per player.
// ctx.players: { [pid]: { pid, role, team, ... } }, ctx.values: { [pid]: { v, ep } }.

export const squadMaxFor = poolSize =>
  Math.min(ECONOMY.squadMaxCap, Math.max(6, Math.floor(poolSize / ECONOMY.managers) - 1));

const valueOf = (ctx, pid) => ctx.values[pid]?.v ?? 0;

// Deal five players each. Buckets are D, I, C and two flex, drawn from the 20th to
// 80th value percentile of the role so stars stay on the market, in serpentine
// order. Up to 20 seeded re-rolls keep every squad's value close to the mean.
export function dealSquads(seed, managerIds, ctx) {
  const all = Object.keys(ctx.players).map(Number);
  const band = role => {
    const ids = all.filter(pid => (role ? ctx.players[pid].role === role : true))
      .sort((a, b) => valueOf(ctx, a) - valueOf(ctx, b));
    const mid = ids.slice(Math.floor(ids.length * 0.2), Math.ceil(ids.length * 0.8));
    // Small pools (a Masters or a half-played event): fall back to the whole role
    // so every manager still gets a player in each bucket.
    return mid.length >= managerIds.length ? mid : ids;
  };
  let best = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rng = rngFor(seed, 'deal', attempt);
    const taken = new Set();
    const squads = Object.fromEntries(managerIds.map(id => [id, []]));
    for (const role of ['duelist', 'initiator', 'controller', null, null]) {
      const pool = shuffle(rng, band(role).filter(pid => !taken.has(pid)));
      const order = attempt % 2 === 0 ? managerIds : [...managerIds].reverse();
      order.forEach((id, i) => {
        const pid = pool[i];
        if (pid != null) { squads[id].push(pid); taken.add(pid); }
      });
    }
    const totals = managerIds.map(id => squads[id].reduce((s, pid) => s + valueOf(ctx, pid), 0));
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const spread = Math.max(...totals.map(t => Math.abs(t - mean) / mean));
    if (!best || spread < best.spread) best = { squads, spread, mean };
    if (spread <= 0.05) break;
  }
  return best;
}

export function createLeague({ seed, campaignId, ctx, dealCtx = ctx, humanName = 'You', kind = 'live', now = 0 }) {
  const aiIds = PERSONALITIES.map((_, i) => `ai${i + 1}`);
  const managerIds = ['you', ...aiIds];
  const { squads, mean } = dealSquads(seed, managerIds, dealCtx);
  const poolSize = Object.keys(ctx.players).length;
  const startCash = Math.round((mean * ECONOMY.startCashFactor) / 10) * 10;

  const owner = {};
  for (const id of managerIds) for (const pid of squads[id]) owner[pid] = id;

  return {
    v: 1,
    seed,
    campaignId,
    kind,
    createdAt: now,
    squadMax: squadMaxFor(poolSize),
    day: 0,
    managers: [
      { id: 'you', kind: 'human', name: humanName },
      ...aiIds.map((id, i) => ({ id, kind: 'ai', personality: PERSONALITIES[i] })),
    ],
    cash: Object.fromEntries(managerIds.map(id => [id, startCash])),
    owner,
    bought: {},
    drafts: {},
    lineups: {},
    market: { day: -1, listings: [], bids: {}, sales: {}, offers: [], aiPlans: {} },
    points: Object.fromEntries(managerIds.map(id => [id, { total: 0, byMatchday: {} }])),
    log: [],
  };
}

export const squadOf = (state, mgr) =>
  Object.keys(state.owner).filter(pid => state.owner[pid] === mgr).map(Number);

export const squadValue = (state, mgr, ctx) =>
  squadOf(state, mgr).reduce((s, pid) => s + valueOf(ctx, pid), 0);

export const payoutFor = points => Math.round((ECONOMY.payoutBase + ECONOMY.payoutPerPoint * Math.max(0, points)) / 10) * 10;

// Settle a matchday: lock lineups into points and pay out. matchdayPoints is
// Map<pid, { total }>; lockedLineups is { [mgr]: { slots, bench, captain } }.
// `autoSubs` and `scoreLineup` are injected so this stays free of scoring imports.
export function settleMatchday(state, mdId, { lockedLineups, matchdayPoints, applyAutoSubs, scoreLineup, mapsPlayedOf }) {
  const next = structuredClone(state);
  const results = {};
  for (const mgr of next.managers) {
    const locked = lockedLineups[mgr.id];
    if (!locked) { results[mgr.id] = { total: 0, subs: [] }; continue; }
    const { starters, subs, captain } = applyAutoSubs(locked, mapsPlayedOf);
    const scored = scoreLineup(SLOTS.map(s => starters[s]).filter(pid => pid != null), captain, matchdayPoints);
    results[mgr.id] = { total: scored.total, subs, captain };
    next.points[mgr.id].total += scored.total;
    next.points[mgr.id].byMatchday[mdId] = scored.total;
    next.cash[mgr.id] += payoutFor(scored.total);
  }
  next.log.push({ k: 'settle', md: mdId, d: next.day });
  return { state: next, results };
}

export function standings(state) {
  return state.managers
    .map(m => ({
      id: m.id,
      total: state.points[m.id].total,
      wins: Object.keys(state.points[m.id].byMatchday).filter(md =>
        state.managers.every(o => state.points[o.id].byMatchday[md] <= state.points[m.id].byMatchday[md])).length,
      best: Math.max(0, ...Object.values(state.points[m.id].byMatchday)),
    }))
    .sort((a, b) => b.total - a.total || b.wins - a.wins || b.best - a.best);
}
