// Scarcity, poaching, targeted signings, and prestige.

import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { eligibleOrgs, mulberry32, samplePack } from '../src/engine/perfectRun.js';
import { tierPools } from '../src/engine/endless/ladder.js';
import {
  PRESTIGE_MIN_TITLES, applyPrestige, canPrestige, canSign, freeAgents,
  holdCost, maxSignableRating, packPool, poachInterest, releaseFee, rollNpcSignings,
  rollPoachOffer, signingCost, signingTargets,
} from '../src/engine/endless/market.js';
import { FEED_CAP, describeNews, newsKit, pushNews } from '../src/engine/endless/news.js';

const pool = tierPools(eligibleOrgs(cards, new Set()), cards)[2];
const squad = cards.filter(c => c.org && c.rating >= 84).slice(0, 5);
const squadIds = new Set(squad.map(c => c.id));

// ── scarcity ────────────────────────────────────────────────────────────────

test('a signed player leaves the pack pool', () => {
  const target = cards.find(c => !squadIds.has(c.id));
  const signedIds = { [target.id]: 'FNC' };

  assert.equal(packPool(cards, squadIds, {}).some(c => c.id === target.id), true);
  assert.equal(packPool(cards, squadIds, signedIds).some(c => c.id === target.id), false);
});

test('your own squad is never offered back to you in a pack', () => {
  const drawn = samplePack(mulberry32(3), packPool(cards, squadIds, {}), new Set(), 40);
  for (const card of drawn) assert.equal(squadIds.has(card.id), false);
});

test('scarcity actually shrinks the pool a pack draws from', () => {
  const signedIds = Object.fromEntries(
    cards.filter(c => !squadIds.has(c.id)).slice(0, 200).map(c => [c.id, 'FNC']),
  );
  const before = packPool(cards, squadIds, {}).length;
  const after = packPool(cards, squadIds, signedIds).length;
  assert.equal(before - after, 200);
});

test('rival signings take real players off the market, and never yours', () => {
  const { signedIds, news } = rollNpcSignings(mulberry32(7), {
    pool, cards, squadIds, signedIds: {},
  });
  assert.ok(news.length > 0, 'a year should move at least one player');
  for (const item of news) {
    assert.equal(squadIds.has(item.cardId), false, 'NPCs must not sign your players here');
    assert.equal(signedIds[item.cardId], item.orgId);
    assert.ok(item.orgName && item.player);
  }
});

test('orgs sign upward, so the world drifts stronger rather than churning', () => {
  const { news } = rollNpcSignings(mulberry32(11), { pool, cards, squadIds, signedIds: {} });
  const byId = new Map(cards.map(c => [c.id, c]));
  for (const item of news) {
    const signed = byId.get(item.cardId);
    const replaced = byId.get(item.replacedId);
    assert.ok(signed.rating > replaced.rating, 'a signing must be an upgrade');
  }
});

test('an already-signed player is not signed twice', () => {
  let signedIds = {};
  for (let year = 0; year < 8; year++) {
    signedIds = rollNpcSignings(mulberry32(year), { pool, cards, squadIds, signedIds }).signedIds;
  }
  const ids = Object.keys(signedIds);
  assert.equal(new Set(ids).size, ids.length, 'no duplicates');
});

// ── poaching ────────────────────────────────────────────────────────────────

test('nobody wants your benched bronze; a benched star is another matter', () => {
  const star = { rating: 92 };
  const filler = { rating: 70 };
  assert.equal(poachInterest({ card: filler, dev: { idle: 9 }, reputation: 0 }), 0);
  assert.ok(poachInterest({ card: star, dev: { idle: 9 }, reputation: 0 }) > 0.5);
});

test('bench time raises interest and reputation lowers it', () => {
  const card = { rating: 90 };
  const played = poachInterest({ card, dev: { idle: 0 }, reputation: 0 });
  const benched = poachInterest({ card, dev: { idle: 4 }, reputation: 0 });
  assert.ok(benched > played, 'leaving a star out invites approaches');

  const shielded = poachInterest({ card, dev: { idle: 4 }, reputation: 900 });
  assert.ok(shielded < benched, 'standing must protect your squad');
});

test('interest is monotonic in reputation', () => {
  const card = { rating: 90 };
  let last = Infinity;
  for (let rep = 0; rep <= 1000; rep += 100) {
    const value = poachInterest({ card, dev: { idle: 2 }, reputation: rep });
    assert.ok(value <= last + 1e-9, 'more standing must never mean more interest');
    last = value;
  }
});

test('holding onto a better player costs more', () => {
  assert.ok(holdCost({ rating: 92 }) > holdCost({ rating: 80 }));
  assert.ok(releaseFee({ rating: 92 }) > releaseFee({ rating: 80 }));
});

test('an offer names a real player and a real suitor', () => {
  const dev = Object.fromEntries(squad.map(c => [c.id, { idle: 5 }]));
  let offer = null;
  for (let seed = 0; seed < 60 && !offer; seed++) {
    offer = rollPoachOffer(mulberry32(seed), { squad, dev, reputation: 0, pool, signedIds: {} });
  }
  assert.ok(offer, 'a benched star squad should eventually draw interest');
  assert.ok(squadIds.has(offer.cardId));
  assert.ok(offer.orgName && offer.holdCost > 0 && offer.releaseFee > 0);
});

test('a fresh, well-rested squad is mostly left alone', () => {
  const dev = Object.fromEntries(squad.map(c => [c.id, { idle: 0 }]));
  let offers = 0;
  for (let seed = 0; seed < 40; seed++) {
    if (rollPoachOffer(mulberry32(seed), { squad, dev, reputation: 700, pool, signedIds: {} })) offers++;
  }
  assert.ok(offers < 20, `a reputable club playing its stars should rarely be raided, got ${offers}/40`);
});

// ── targeted signings ───────────────────────────────────────────────────────

test('reputation gates who will sign for you', () => {
  assert.ok(maxSignableRating(0) < maxSignableRating(900));
  const icon = cards.find(c => c.rating >= 93);
  assert.deepEqual(canSign(icon, { packs: 99, reputation: 0 }), { ok: false, reason: 'reputation' });
  assert.equal(canSign(icon, { packs: 99, reputation: 900 }).ok, true);
});

test('packs are the price, and a better player costs more', () => {
  assert.ok(signingCost({ rating: 92 }) > signingCost({ rating: 75 }));
  const target = cards.find(c => c.rating === 80);
  assert.deepEqual(canSign(target, { packs: 0, reputation: 900 }), { ok: false, reason: 'packs' });
});

test('the shortlist offers everyone your club could attract, not just what you can afford right now', () => {
  // packs is no longer part of the shortlist filter - it only gates the
  // actual signing (canSign/signingCost). A target here may cost more than
  // the player currently has; that's the point (a shop window, not just a
  // receipt of what's already in reach).
  const targets = signingTargets(cards, { squadIds, signedIds: {}, reputation: 200 });
  assert.ok(targets.length > 0);
  const ceiling = maxSignableRating(200);
  for (const card of targets) {
    assert.ok(card.rating <= ceiling);
    assert.notEqual(card.league, 'icon');
    assert.equal(squadIds.has(card.id), false);
  }
  assert.ok(
    targets.some(card => canSign(card, { packs: 0, reputation: 200 }).reason === 'packs'),
    'expected at least one shortlisted target the player cannot afford yet',
  );
});

test('a signed-away player cannot also be signed by you', () => {
  const targets = signingTargets(cards, { squadIds, signedIds: {}, packs: 9, reputation: 999, limit: 3 });
  const signedIds = { [targets[0].id]: 'FNC' };
  const after = signingTargets(cards, { squadIds, signedIds, packs: 9, reputation: 999, limit: 3 });
  assert.equal(after.some(c => c.id === targets[0].id), false);
});

test('free agents exclude both your squad and everyone signed', () => {
  const signedIds = { [cards[300].id]: 'FNC' };
  const free = freeAgents(cards, squadIds, signedIds);
  assert.equal(free.length, cards.length - squadIds.size - 1);
});

// ── prestige ────────────────────────────────────────────────────────────────

test('prestige is gated on reaching the top and winning there', () => {
  assert.deepEqual(canPrestige({ tier: 1, titles: 9, prestige: {} }), { ok: false, reason: 'tier' });
  assert.deepEqual(canPrestige({ tier: 2, titles: 0, prestige: {} }), { ok: false, reason: 'titles' });
  assert.equal(canPrestige({ tier: 2, titles: PRESTIGE_MIN_TITLES, prestige: {} }).ok, true);
});

test('banking compounds, so walking away beats farming a solved run', () => {
  let prestige = { level: 0, multiplier: 1, bankedScore: 0 };
  prestige = applyPrestige(prestige, 1000);
  assert.equal(prestige.level, 1);
  assert.equal(prestige.bankedScore, 1000);
  assert.equal(prestige.multiplier, 1.5);

  prestige = applyPrestige(prestige, 1000);
  assert.equal(prestige.bankedScore, 2500, 'the same run is worth more the second time');
  assert.equal(prestige.multiplier, 2);
});

// ── news ────────────────────────────────────────────────────────────────────

test('the feed is bounded so a long run cannot grow the save', () => {
  let feed = [];
  for (let i = 0; i < 200; i++) {
    feed = pushNews(feed, [{ kind: 'signing', player: `p${i}`, orgName: 'X' }], { year: 1, event: i });
  }
  assert.equal(feed.length, FEED_CAP);
  assert.equal(feed[0].player, 'p199', 'newest first');
});

test('every news kind renders to real copy', () => {
  const samples = [
    { kind: 'signing', orgName: 'FNATIC', player: 'Boaster' },
    { kind: 'poach', orgName: 'NRG', player: 'TenZ' },
    { kind: 'departure', orgName: 'NRG', player: 'TenZ' },
    { kind: 'held', orgName: 'NRG', player: 'TenZ' },
    { kind: 'signed', player: 'aspas' },
    { kind: 'prospect', player: 'hydro' },
    { kind: 'promote', tierLabel: 'International' },
    { kind: 'relegate', tierLabel: 'Challengers' },
    { kind: 'legend', player: 'Chronicle' },
    { kind: 'bond', player: 'Derke', player2: 'Boaster' },
  ];
  for (const item of samples) {
    const { title, note } = describeNews(item);
    assert.ok(title && title.length > 4, `${item.kind} needs a title`);
    assert.equal(typeof note, 'string');
    assert.equal(title.includes('undefined'), false, `${item.kind} has a hole in its copy`);
  }
});

test('only transfers request a kit swap', () => {
  assert.equal(newsKit({ kind: 'signing', orgId: 'FNC' }), 'FNC');
  assert.equal(newsKit({ kind: 'departure', orgId: 'NRG' }), 'NRG');
  assert.equal(newsKit({ kind: 'legend', orgId: 'FNC' }), null);
});

test('news items stay small and serializable', () => {
  const feed = pushNews([], [{ kind: 'signing', orgId: 'FNC', orgName: 'FNATIC', cardId: 'x', player: 'B' }], { year: 2, event: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(feed)), feed);
  assert.ok(JSON.stringify(feed).length < 300);
});
