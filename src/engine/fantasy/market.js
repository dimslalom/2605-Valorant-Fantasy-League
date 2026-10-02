import { ECONOMY } from './constants.js';
import { aiOffer, aiPlan } from './ai.js';
import { addOwner, freeCopies, owns, removeOwner, squadOf, standings } from './league.js';
import { pickWeighted, rngFor } from './rng.js';

// Daily market. Listings are seeded per (league, day); bids are sealed and
// resolve together at close. No debt: bids are checked against cash plus the
// value of queued sales, and re-checked at resolution.

export class MarketError extends Error {}

const round10 = n => Math.round(n / 10) * 10;

// Stratified by EP quartile (2 top, 4 middle, 2 bottom for 8 listings), weighted
// toward players with a series coming up and players in form.
export function pickListings(state, dayKey, ctx, count) {
  const rng = rngFor(state.seed, dayKey, 'listings');
  const free = Object.keys(ctx.players).map(Number).filter(pid => freeCopies(state, pid) > 0);
  const target = Math.min(count, Math.floor(free.length * 0.4));
  const ranked = [...free].sort((a, b) => ctx.values[b].ep - ctx.values[a].ep || a - b);
  const q = Math.ceil(ranked.length / 4);
  const strata = [
    { ids: ranked.slice(0, q), take: Math.round(target * 0.25) },
    { ids: ranked.slice(q, 3 * q), take: Math.round(target * 0.5) },
    { ids: ranked.slice(3 * q), take: target - Math.round(target * 0.25) - Math.round(target * 0.5) },
  ];
  const chosen = [];
  for (const { ids, take } of strata) {
    const pool = [...ids];
    for (let i = 0; i < take && pool.length; i += 1) {
      const pid = pickWeighted(rng, pool, p => 1 + 1.5 * ((ctx.seriesNext?.[p] ?? 1) > 0 ? 1 : 0) + (ctx.values[p].form >= 3 ? 1 : 0));
      chosen.push(pid);
      pool.splice(pool.indexOf(pid), 1);
    }
  }
  return chosen.map(pid => ({ pid, min: ctx.values[pid].v }));
}

export function openMarket(state, dayKey, ctx, { replay = false } = {}) {
  const next = structuredClone(state);
  next.day = dayKey;
  next.market = {
    day: dayKey,
    listings: pickListings(next, dayKey, ctx, replay ? ECONOMY.listingsReplay : ECONOMY.listingsLive),
    bids: { you: {} },
    sales: { you: [] },
    offers: [],
    aiPlans: {},
  };
  for (const m of next.managers.filter(x => x.kind === 'ai')) {
    next.market.aiPlans[m.id] = aiPlan(next, m.id, dayKey, ctx);
  }
  const offer = aiOffer(next, dayKey, ctx);
  if (offer) next.market.offers.push(offer);
  return next;
}

const pendingSaleValue = (state, mgr, ctx) =>
  (state.market.sales[mgr] ?? []).reduce((s, pid) => s + ctx.values[pid].v, 0);
const committed = (state, mgr) => Object.values(state.market.bids[mgr] ?? {}).reduce((s, a) => s + a, 0);

export function queueBid(state, mgr, pid, amt, ctx) {
  const listing = state.market.listings.find(l => l.pid === pid);
  if (!listing) throw new MarketError('not listed');
  if (owns(state, mgr, pid)) throw new MarketError('you already have this player');
  if (!Number.isInteger(amt) || amt < listing.min) throw new MarketError('below the minimum');
  const bids = state.market.bids[mgr] ?? {};
  const others = committed(state, mgr) - (bids[pid] ?? 0);
  if (amt + others > state.cash[mgr] + pendingSaleValue(state, mgr, ctx)) throw new MarketError('not enough credits');
  const slots = state.squadMax - squadOf(state, mgr).length + (state.market.sales[mgr] ?? []).length;
  if (!bids[pid] && Object.keys(bids).length >= slots) throw new MarketError('no free squad slot');
  const next = structuredClone(state);
  next.market.bids[mgr] = { ...bids, [pid]: amt };
  return next;
}

export function cancelBid(state, mgr, pid) {
  const next = structuredClone(state);
  delete next.market.bids[mgr]?.[pid];
  return next;
}

export function queueSale(state, mgr, pid) {
  if (!owns(state, mgr, pid)) throw new MarketError('not your player');
  const next = structuredClone(state);
  const sales = next.market.sales[mgr] ?? [];
  if (!sales.includes(pid)) sales.push(pid);
  next.market.sales[mgr] = sales;
  return next;
}

export function acceptOffer(state, offerId) {
  const offer = state.market.offers.find(o => o.id === offerId);
  if (!offer) throw new MarketError('no such offer');
  const next = structuredClone(state);
  next.market.offers.find(o => o.id === offerId).accepted = true;
  return next;
}

// Resolve the day. Order: system sales, accepted offers, then auctions in
// descending top-bid order. Ties go to the manager lower in the standings, then
// a seeded coin flip. Bids a manager can no longer pay or fit are void and the
// next-highest bid wins.
export function closeMarket(state, ctx) {
  const next = structuredClone(state);
  const m = next.market;
  const report = { sold: [], offers: [], auctions: [] };
  const sell = (mgr, pid, price) => {
    removeOwner(next, mgr, pid);
    delete next.bought[`${mgr}:${pid}`];
    next.cash[mgr] += price;
  };
  const sign = (mgr, pid, price) => {
    addOwner(next, mgr, pid);
    next.bought[`${mgr}:${pid}`] = { price, day: next.day };
    next.cash[mgr] -= price;
  };

  // 1. System sales at today's value.
  const sales = { ...m.sales };
  for (const [id, plan] of Object.entries(m.aiPlans)) {
    sales[id] = [...(sales[id] ?? []), ...plan.filter(c => c.type === 'sell').map(c => c.pid)];
  }
  for (const [mgr, pids] of Object.entries(sales)) {
    for (const pid of pids) {
      if (!owns(next, mgr, pid)) continue;
      const price = ctx.values[pid].v;
      sell(mgr, pid, price);
      report.sold.push({ mgr, pid, price });
    }
  }

  // 2. Accepted offers: the AI buys the player at the offered price.
  for (const offer of m.offers.filter(o => o.accepted)) {
    const seller = offer.to;
    if (!owns(next, seller, offer.pid) || owns(next, offer.from, offer.pid)
      || next.cash[offer.from] < offer.amt || squadOf(next, offer.from).length >= next.squadMax) continue;
    sell(seller, offer.pid, offer.amt);
    sign(offer.from, offer.pid, offer.amt);
    report.offers.push({ ...offer });
  }

  // 3. Auctions.
  const bidsByPid = {};
  for (const [mgr, bids] of Object.entries(m.bids)) {
    for (const [pid, amt] of Object.entries(bids)) (bidsByPid[pid] ??= []).push({ mgr, amt });
  }
  for (const [mgr, plan] of Object.entries(m.aiPlans)) {
    for (const c of plan.filter(x => x.type === 'bid')) (bidsByPid[c.pid] ??= []).push({ mgr, amt: c.amt });
  }
  const rank = Object.fromEntries(standings(state).map((s, i) => [s.id, i])); // 0 is the leader
  const order = Object.entries(bidsByPid).sort((a, b) =>
    Math.max(...b[1].map(x => x.amt)) - Math.max(...a[1].map(x => x.amt)) || Number(a[0]) - Number(b[0]));
  for (const [pidStr, bids] of order) {
    const pid = Number(pidStr);
    const tie = rngFor(next.seed, next.day, 'tie', pid);
    const sorted = [...bids].sort((a, b) => b.amt - a.amt || rank[b.mgr] - rank[a.mgr] || tie() - 0.5);
    const entry = { pid, bids: sorted.map(b => ({ ...b })), winner: null, winners: [] };
    // Each free copy goes to the next-highest bid that can pay and fit; winners pay what they bid.
    for (const bid of sorted) {
      if (freeCopies(next, pid) <= 0) break;
      if (owns(next, bid.mgr, pid)) continue;
      if (next.cash[bid.mgr] >= bid.amt && squadOf(next, bid.mgr).length < next.squadMax) {
        sign(bid.mgr, pid, bid.amt);
        entry.winners.push(bid.mgr);
      }
    }
    entry.winner = entry.winners[0] ?? null;
    report.auctions.push(entry);
  }
  for (const a of report.auctions) {
    for (const mgr of a.winners) next.log.push({ k: 'signed', pid: a.pid, mgr, amt: a.bids.find(b => b.mgr === mgr).amt, d: next.day });
  }
  next.market = { day: next.day, listings: [], bids: { you: {} }, sales: { you: [] }, offers: [], aiPlans: {} };
  return { state: next, report };
}

export { round10 };
