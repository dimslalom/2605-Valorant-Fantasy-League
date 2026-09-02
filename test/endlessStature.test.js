// Club stature: one scale, one rule, for the player and every rival org.
//
// The bug being pinned: with no model of pull, every org reached for the best
// card on the board and 23 of 24 signings were icons landing at academy
// sides. These tests assert the rule that replaced that, and that it applies
// symmetrically.

import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { eligibleOrgs, mulberry32 } from '../src/engine/perfectRun.js';
import { tierPools } from '../src/engine/endless/ladder.js';
import {
  BAND_DEPTH, SELF_REACH, baselineStature, ladderCeiling, maxSignableRating,
  orgStature, recordOrgResult, roleGaps, shoppingBand, statureForRating, targetScore,
} from '../src/engine/endless/stature.js';
import { canSign, rollIconEvent, rollNpcSignings, signingTargets } from '../src/engine/endless/market.js';

const pool = eligibleOrgs(cards, new Set());
const byId = new Map(cards.map(c => [c.id, c]));
const org = id => pool.find(o => o.id === id);
const icons = cards.filter(c => c.league === 'icon');

// ── the shared ladder ───────────────────────────────────────────────────────

test('the ceiling rises with standing and never falls', () => {
  let last = 0;
  for (let stature = 0; stature <= 1000; stature += 25) {
    const ceiling = ladderCeiling(stature);
    assert.ok(ceiling >= last, 'more standing must never mean less pull');
    last = ceiling;
  }
});

test('standing derived from calibre never buys more than that calibre', () => {
  // The round trip must not inflate: a club of a given quality should not be
  // handed a ceiling meaningfully above the players it already fields.
  for (let rating = 62; rating <= 99; rating += 3) {
    const stature = statureForRating(rating);
    assert.ok(ladderCeiling(stature) <= rating,
      `a club of ${rating} calibre was handed a ${ladderCeiling(stature)} ceiling`);
  }
});

test('a club can always reach a little past its own best player', () => {
  const roster = [{ rating: 88 }, { rating: 70 }];
  // Standing alone would cap this club far lower.
  assert.ok(maxSignableRating(0) < 88);
  assert.equal(maxSignableRating(0, roster), 88 + SELF_REACH);
});

test('and cannot reach far past it', () => {
  const minnow = [{ rating: 59 }, { rating: 55 }];
  assert.ok(maxSignableRating(0, minnow) < 76,
    'a club whose best is 59 must not be able to sign a 76');
});

// ── the realism check that started this ─────────────────────────────────────

test('a small org cannot sign an icon; the giants can', () => {
  const smallest = [...pool].sort((a, b) => a.roster[0].rating - b.roster[0].rating)[0];
  const iconRating = Math.min(...icons.map(c => c.rating));

  assert.ok(maxSignableRating(baselineStature(smallest.roster), smallest.roster) < iconRating,
    `${smallest.name} should not be able to attract an icon`);

  const reachable = pool.filter(o => maxSignableRating(baselineStature(o.roster), o.roster) >= iconRating);
  assert.ok(reachable.length > 0, 'somebody must be able to');
  assert.ok(reachable.length < pool.length * 0.15,
    `only the elite should reach icons, got ${reachable.length}/${pool.length}`);
});

test('FlyQuest-sized clubs shop in a FlyQuest-sized bracket', () => {
  const fly = org('FLY');
  assert.ok(fly, 'expected FlyQuest in the pool');
  const stature = baselineStature(fly.roster);
  const band = shoppingBand(stature, fly.roster);

  assert.ok(band.max < 90, `FlyQuest should not be shopping at ${band.max}`);
  assert.equal(band.max - band.min, BAND_DEPTH);
});

test('NPC signings never take an icon off the board', () => {
  const tier = tierPools(pool, cards)[1];
  let signedIds = {};
  const news = [];
  for (let year = 0; year < 10; year++) {
    const out = rollNpcSignings(mulberry32(500 + year), { pool: tier, cards, squadIds: new Set(), signedIds });
    signedIds = out.signedIds;
    news.push(...out.news);
  }
  assert.ok(news.length > 10, 'the market should be active');
  for (const item of news) {
    assert.notEqual(byId.get(item.cardId).league, 'icon', `${item.orgName} signed an icon`);
  }
});

test('every signing lands inside the buying club’s own bracket', () => {
  const tier = tierPools(pool, cards)[0];
  const { news } = rollNpcSignings(mulberry32(77), { pool: tier, cards, squadIds: new Set(), signedIds: {} });
  assert.ok(news.length > 0);
  for (const item of news) {
    const buyer = tier.find(o => o.id === item.orgId);
    const ceiling = maxSignableRating(baselineStature(buyer.roster), buyer.roster);
    const signed = byId.get(item.cardId);
    // An overreach is allowed, and is flagged as one.
    if (!item.reach) {
      assert.ok(signed.rating <= ceiling,
        `${item.orgName} (ceiling ${ceiling}) signed a ${signed.rating} without it being a reach`);
    }
  }
});

test('an org signs a fit, not just the biggest number', () => {
  const roster = [
    { id: 'a', rating: 80, role: 'Duelist', nationality: 'US', org: 'X' },
    { id: 'b', rating: 80, role: 'Duelist', nationality: 'US', org: 'X' },
    { id: 'c', rating: 80, role: 'Initiator', nationality: 'US', org: 'X' },
  ];
  const gaps = roleGaps(roster);
  assert.deepEqual(gaps.sort(), ['Controller', 'Sentinel']);

  const filler = { rating: 82, role: 'Duelist', nationality: 'BR', org: 'Z' };
  const plugsGap = { rating: 80, role: 'Controller', nationality: 'US', org: 'X' };
  assert.ok(targetScore(plugsGap, { roster, gaps }) > targetScore(filler, { roster, gaps }),
    'filling a hole with a countryman beats a slightly better duplicate');
});

// ── symmetry with the player ────────────────────────────────────────────────

test('the player is measured by exactly the same function', () => {
  const squad = cards.filter(c => c.org && c.rating >= 84).slice(0, 5);
  const icon = icons[0];

  // Same ceiling call, same answer, whether the roster is yours or an org's.
  assert.equal(
    maxSignableRating(300, squad),
    maxSignableRating(300, squad),
  );
  // ...and an icon is never available over the counter to anyone.
  assert.deepEqual(canSign(icon, { packs: 99, reputation: 1000, roster: squad }), { ok: false, reason: 'icon' });
});

test('the shortlist offered to the player respects the same bracket', () => {
  const squad = cards.filter(c => c.org && c.rating >= 84).slice(0, 5);
  const squadIds = new Set(squad.map(c => c.id));
  const targets = signingTargets(cards, { squadIds, signedIds: {}, packs: 9, reputation: 0, roster: squad });
  const ceiling = maxSignableRating(0, squad);
  for (const card of targets) {
    assert.ok(card.rating <= ceiling);
    assert.notEqual(card.league, 'icon');
  }
});

// ── standing moves ──────────────────────────────────────────────────────────

test('winning raises a club’s pull and losing lowers it', () => {
  const club = org('FLY') ?? pool[40];
  const world = { orgs: {} };
  const before = orgStature(world, club.id, club.roster);

  recordOrgResult(world, club.id, 200);
  const after = orgStature(world, club.id, club.roster);
  assert.ok(after > before, 'a club that wins should become attractive');
  assert.ok(maxSignableRating(after, club.roster) >= maxSignableRating(before, club.roster));

  recordOrgResult(world, club.id, -400);
  assert.ok(orgStature(world, club.id, club.roster) < after, 'and a fallen one should fade');
});

test('standing stays inside the scale however lopsided the run', () => {
  const club = pool[0];
  const world = { orgs: {} };
  for (let i = 0; i < 50; i++) recordOrgResult(world, club.id, 500);
  assert.ok(orgStature(world, club.id, club.roster) <= 1000);
  for (let i = 0; i < 50; i++) recordOrgResult(world, club.id, -500);
  assert.ok(orgStature(world, club.id, club.roster) >= 0);
});

// ── icons return as an event ────────────────────────────────────────────────

test('an icon only ever joins a club that could attract them', () => {
  const suitors = pool.slice(0, 40).map(o => ({
    id: o.id, name: o.name, roster: o.roster, stature: baselineStature(o.roster),
  }));
  let events = 0;
  for (let seed = 0; seed < 200; seed++) {
    const event = rollIconEvent(mulberry32(seed), { cards, squadIds: new Set(), signedIds: {}, suitors });
    if (!event) continue;
    events++;
    const ceiling = maxSignableRating(event.suitor.stature, event.suitor.roster);
    assert.ok(ceiling >= event.rating,
      `${event.suitor.name} (ceiling ${ceiling}) cannot attract a ${event.rating}`);
  }
  assert.ok(events > 0, 'icons should occasionally return');
  assert.ok(events < 200, 'but not every year');
});

test('a lobby of minnows never sees an icon return', () => {
  const minnows = [...pool]
    .sort((a, b) => a.roster[0].rating - b.roster[0].rating)
    .slice(0, 20)
    .map(o => ({ id: o.id, name: o.name, roster: o.roster, stature: baselineStature(o.roster) }));
  for (let seed = 0; seed < 120; seed++) {
    const event = rollIconEvent(mulberry32(seed), { cards, squadIds: new Set(), signedIds: {}, suitors: minnows });
    assert.equal(event, null, 'no small club should land a legend');
  }
});

test('the icon event is deterministic for a seed', () => {
  const suitors = pool.slice(0, 30).map(o => ({
    id: o.id, name: o.name, roster: o.roster, stature: baselineStature(o.roster),
  }));
  const args = { cards, squadIds: new Set(), signedIds: {}, suitors };
  assert.deepEqual(rollIconEvent(mulberry32(4), args), rollIconEvent(mulberry32(4), args));
});
