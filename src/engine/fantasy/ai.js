import { PERSONALITIES } from './constants.js';
import { squadOf } from './league.js';
import { rngFor } from './rng.js';
import { valueFromEP } from './values.js';

// AI rival managers. They see exactly what the player sees (EP, values, who is
// listed) and never future data. Plans are computed at market open from a state
// snapshot, so nothing the player does later can influence them, and they are
// the same command objects a human would send:  { type: 'bid', pid, amt } or
// { type: 'sell', pid }.

export const PROFILES = {
  analyst:  { prem: [0.02, 0.06], bids: 1, reserve: 0.10, offer: [0.03, 0.06] },
  whale:    { prem: [0.08, 0.18], bids: 2, reserve: 0,    offer: [0.10, 0.20] },
  loyalist: { prem: [0.05, 0.12], bids: 1, reserve: 0.10, offer: [0.10, 0.15] },
  trader:   { prem: [0.03, 0.08], bids: 2, reserve: 0.05, offer: [0.05, 0.10] },
  scout:    { prem: [0.00, 0.04], bids: 1, reserve: 0.25, offer: [0.02, 0.05] },
  gambler:  { prem: [0.06, 0.15], bids: 2, reserve: 0,    offer: [0.05, 0.12] },
  steady:   { prem: [0.00, 0.03], bids: 1, reserve: 0.20, offer: [0.02, 0.04] },
};

const personalityOf = (state, mgrId) => state.managers.find(m => m.id === mgrId).personality;
const lerp = ([lo, hi], u) => lo + (hi - lo) * u;
const round10 = n => Math.round(n / 10) * 10;

// The org a loyalist favours: seeded among teams with at least four players.
function favouriteTeam(state, ctx, mgrId) {
  const counts = {};
  for (const p of Object.values(ctx.players)) counts[p.team] = (counts[p.team] ?? 0) + 1;
  const teams = Object.keys(counts).filter(t => counts[t] >= 4).sort();
  return teams[Math.floor(rngFor(state.seed, 'fav', mgrId)() * teams.length)];
}

const roleCounts = (pids, ctx) => pids.reduce((c, pid) => ({ ...c, [ctx.players[pid].role]: (c[ctx.players[pid].role] ?? 0) + 1 }), {});

// How much this personality wants a listed player. Higher is better; <= 0 skips.
function want(personality, state, mgrId, pid, ctx, held) {
  const row = ctx.values[pid];
  const ratio = row.ep / Math.max(1, row.v / 100);
  switch (personality) {
    case 'analyst': return ratio;
    case 'whale': return row.v;
    case 'loyalist': {
      const fav = favouriteTeam(state, ctx, mgrId);
      const mine = held.filter(h => ctx.players[h].team === fav).length;
      return ctx.players[pid].team === fav && mine < 4 ? 1000 + row.ep : row.ep / 10;
    }
    case 'trader': return row.form >= 3 ? row.form : 0;
    case 'scout': return row.v < 4000 ? row.ep : 0;
    case 'gambler': return (ctx.seriesNext?.[pid] ?? 1) * 10 + row.ep / 10;
    case 'steady': {
      const counts = roleCounts(held, ctx);
      return (counts[ctx.players[pid].role] ?? 0) === 0 ? 100 + row.ep : 0;
    }
    default: return 0;
  }
}

// Fair value the AI would pay for a player, given its bias.
const fairValue = (personality, state, mgrId, pid, ctx) => {
  const bias = personality === 'loyalist' && ctx.players[pid].team === favouriteTeam(state, ctx, mgrId) ? 4 : 0;
  return valueFromEP(ctx.values[pid].ep + bias);
};

export function aiPlan(state, mgrId, dayKey, ctx) {
  const personality = personalityOf(state, mgrId);
  const profile = PROFILES[personality];
  const rng = rngFor(state.seed, dayKey, mgrId, 'plan');
  const commands = [];
  let held = squadOf(state, mgrId);
  let cash = state.cash[mgrId];

  // Sell players who are OUT, and for traders anything up 10% since purchase.
  for (const pid of held) {
    const row = ctx.values[pid];
    const paid = state.bought[pid]?.price;
    if (row.o === 'OUT' || (personality === 'trader' && paid && row.v >= paid * 1.1)) {
      commands.push({ type: 'sell', pid });
      cash += row.v;
      held = held.filter(h => h !== pid);
    }
  }

  const candidates = state.market.listings
    .map(l => l.pid)
    .filter(pid => state.owner[pid] == null)
    .map(pid => ({ pid, score: want(personality, state, mgrId, pid, ctx, held) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score || a.pid - b.pid);

  const room = state.squadMax - held.length;
  let bids = 0;
  for (const { pid } of candidates) {
    if (bids >= Math.min(profile.bids, room)) break;
    const value = ctx.values[pid].v;
    const maxBid = Math.min(cash * (1 - profile.reserve), fairValue(personality, state, mgrId, pid, ctx) * (1 + profile.prem[1]));
    if (value > maxBid) continue;
    const amt = Math.min(round10(value * (1 + lerp(profile.prem, rng()))), Math.floor(maxBid / 10) * 10);
    if (amt < value || amt > cash) continue;
    commands.push({ type: 'bid', pid, amt });
    cash -= amt;
    bids += 1;
  }
  return commands;
}

// At most one offer per close to a human: the highest amount across the AI
// managers, only for a player an AI values at least 5% above the market value.
export function aiOffer(state, dayKey, ctx) {
  const human = state.managers.find(m => m.kind === 'human').id;
  let best = null;
  for (const pid of squadOf(state, human)) {
    for (const mgr of state.managers.filter(m => m.kind === 'ai')) {
      const personality = mgr.personality;
      const value = ctx.values[pid].v;
      if (fairValue(personality, state, mgr.id, pid, ctx) < value * 1.05) continue;
      if (squadOf(state, mgr.id).length >= state.squadMax) continue;
      const rng = rngFor(state.seed, dayKey, mgr.id, 'offer', pid);
      if (rng() > 0.35) continue;
      const amt = round10(value * (1 + lerp(PROFILES[personality].offer, rng())));
      if (amt > state.cash[mgr.id]) continue;
      if (!best || amt > best.amt) best = { id: `${dayKey}:${mgr.id}:${pid}`, from: mgr.id, pid, amt, accepted: false };
    }
  }
  return best;
}

export { PERSONALITIES };
