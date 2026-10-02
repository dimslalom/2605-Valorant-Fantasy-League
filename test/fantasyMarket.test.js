import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeague, squadOf, squadValue, standings } from '../src/engine/fantasy/league.js';
import { acceptOffer, closeMarket, openMarket, queueBid, queueSale } from '../src/engine/fantasy/market.js';
import { synthCtx } from './fixtures/fantasySynth.js';

const ctx = synthCtx(1);
const day = n => `d${n}`;

function invariants(state) {
  const seen = new Set();
  for (const [pid, mgr] of Object.entries(state.owner)) {
    assert.ok(!seen.has(pid), 'a player has two owners');
    seen.add(pid);
    assert.ok(state.managers.some(m => m.id === mgr));
  }
  for (const m of state.managers) {
    assert.ok(state.cash[m.id] >= 0, `${m.id} went into debt`);
    const n = squadOf(state, m.id).length;
    assert.ok(n >= 0 && n <= state.squadMax, `${m.id} squad size ${n}`);
  }
}

test('the deal is fair and exclusive: eight squads of five within a few percent of each other', () => {
  const state = createLeague({ seed: 5, campaignId: 'x', ctx });
  invariants(state);
  assert.equal(state.managers.length, 8);
  const totals = state.managers.map(m => squadValue(state, m.id, ctx));
  const mean = totals.reduce((a, b) => a + b) / 8;
  assert.ok(Math.max(...totals.map(t => Math.abs(t - mean) / mean)) < 0.12);
  assert.ok(state.managers.every(m => squadOf(state, m.id).length === 5));
  assert.ok(state.cash.you > 0);
});

test('everything is deterministic from the seed', () => {
  const a = openMarket(createLeague({ seed: 9, campaignId: 'x', ctx }), day(1), ctx);
  const b = openMarket(createLeague({ seed: 9, campaignId: 'x', ctx }), day(1), ctx);
  assert.deepEqual(a, b);
  const c = openMarket(createLeague({ seed: 10, campaignId: 'x', ctx }), day(1), ctx);
  assert.notDeepEqual(a.market.listings, c.market.listings);
});

test('listings: eight, unowned, and AI plans exist for every rival', () => {
  const s = openMarket(createLeague({ seed: 3, campaignId: 'x', ctx }), day(1), ctx);
  assert.equal(s.market.listings.length, 8);
  assert.ok(s.market.listings.every(l => s.owner[l.pid] == null && l.min === ctx.values[l.pid].v));
  assert.equal(Object.keys(s.market.aiPlans).length, 7);
});

test('bids: below minimum, over budget and unlisted are refused; the winner pays, the squad grows', () => {
  let s = openMarket(createLeague({ seed: 3, campaignId: 'x', ctx }), day(1), ctx);
  const pid = s.market.listings[0].pid;
  const min = s.market.listings[0].min;
  assert.throws(() => queueBid(s, 'you', pid, min - 10, ctx), /minimum/);
  assert.throws(() => queueBid(s, 'you', 99999, min, ctx), /not listed/);
  assert.throws(() => queueBid(s, 'you', pid, s.cash.you + 10, ctx), /credits/);
  // Free a slot first: the squad starts at five of a max of six or seven.
  s = queueBid(s, 'you', pid, min + 5000 > s.cash.you ? s.cash.you : min + 5000, ctx);
  const before = s.cash.you;
  const { state, report } = closeMarket(s, ctx);
  invariants(state);
  const auction = report.auctions.find(a => a.pid === pid);
  if (auction.winner === 'you') {
    assert.ok(state.cash.you < before);
    assert.equal(state.owner[pid], 'you');
  } else {
    assert.equal(state.cash.you, before + 0);  // lost the auction: nothing charged
  }
});

test('sales pay the value at close, and an accepted offer moves the player to the rival', () => {
  let s = openMarket(createLeague({ seed: 4, campaignId: 'x', ctx }), day(1), ctx);
  const pid = squadOf(s, 'you')[0];
  s = queueSale(s, 'you', pid);
  const before = s.cash.you;
  const { state } = closeMarket(s, ctx);
  assert.equal(state.owner[pid], undefined);
  assert.equal(state.cash.you, before + ctx.values[pid].v);

  // offers: find a seed that produces one, then accept it
  for (let seed = 1; seed < 40; seed += 1) {
    let t = openMarket(createLeague({ seed, campaignId: 'x', ctx }), day(1), ctx);
    if (!t.market.offers.length) continue;
    const offer = t.market.offers[0];
    t = acceptOffer(t, offer.id);
    const r = closeMarket(t, ctx);
    if (r.report.offers.length) {
      assert.equal(r.state.owner[offer.pid], offer.from);
      assert.ok(offer.amt >= ctx.values[offer.pid].v);
      invariants(r.state);
      return;
    }
  }
  assert.fail('no seed produced an offer that could close');
});

test('AI stays solvent and active over a 20-day league with a passive human', () => {
  let s = createLeague({ seed: 11, campaignId: 'x', ctx });
  let signings = 0;
  const startTotals = s.managers.map(m => squadValue(s, m.id, ctx));
  for (let d = 1; d <= 20; d += 1) {
    s = openMarket(s, day(d), ctx);
    const r = closeMarket(s, ctx);
    s = r.state;
    signings += r.report.auctions.filter(a => a.winner).length;
    invariants(s);
  }
  assert.ok(signings >= 8, `only ${signings} signings in 20 days`);
  const mean = s.managers.map(m => squadValue(s, m.id, ctx));
  mean.forEach((t, i) => assert.ok(t > startTotals[i] * 0.3 && t < startTotals[i] * 3));
});

test('churn exploit: buying every listing at minimum and selling next close cannot print money', () => {
  let s = createLeague({ seed: 12, campaignId: 'x', ctx });
  const start = s.cash.you + squadValue(s, 'you', ctx);
  for (let d = 1; d <= 20; d += 1) {
    s = openMarket(s, day(d), ctx);
    for (const pid of squadOf(s, 'you')) if (s.bought[pid]) s = queueSale(s, 'you', pid);
    for (const l of s.market.listings) {
      try { s = queueBid(s, 'you', l.pid, l.min, ctx); } catch { /* full or broke */ }
    }
    s = closeMarket(s, ctx).state;
    invariants(s);
  }
  const end = s.cash.you + squadValue(s, 'you', ctx);
  assert.ok(end <= start * 1.15, `wealth ${start} -> ${end}`);
});

test('standings sort by total then matchday wins', () => {
  const s = createLeague({ seed: 1, campaignId: 'x', ctx });
  s.points.you.total = 10;
  s.points.ai1.total = 30;
  assert.equal(standings(s)[0].id, 'ai1');
});
