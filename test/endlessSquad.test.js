// Bench slots, the youth academy, and NPC development parity.

import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { eligibleOrgs, mulberry32 } from '../src/engine/perfectRun.js';
import { BASE_SLOTS, MAX_SLOTS, slotUnlockAt, slotsFor, tierPools } from '../src/engine/endless/ladder.js';
import { careerStage, emptyDev, tickCareerYear } from '../src/engine/endless/career.js';
import { PROSPECT_MAX_RATING, prospectPool, rollYouthProspect } from '../src/engine/endless/academy.js';
import { MAX_TRACKED_ORGS, developCards, tickWorldYear } from '../src/engine/endless/world.js';
import { endlessFieldPool } from '../src/engine/endless/field.js';

const SEED = 4242;

// ── bench slots ─────────────────────────────────────────────────────────────

test('slots unlock with completed years and then stop', () => {
  assert.equal(slotsFor(0), BASE_SLOTS);
  assert.equal(slotsFor(1), 6);
  assert.equal(slotsFor(2), 6);
  assert.equal(slotsFor(3), 7);
  assert.equal(slotsFor(6), MAX_SLOTS);
  assert.equal(slotsFor(40), MAX_SLOTS, 'depth must not grow without bound');
});

test('slots only ever increase', () => {
  let last = 0;
  for (let year = 0; year <= 20; year++) {
    const slots = slotsFor(year);
    assert.ok(slots >= last, 'a squad slot must never be taken away');
    last = slots;
  }
});

test('an unlock is announced exactly on the year it happens', () => {
  assert.equal(slotUnlockAt(1).slots, 6);
  assert.equal(slotUnlockAt(2), null);
  assert.equal(slotUnlockAt(3).slots, 7);
});

// ── youth academy ───────────────────────────────────────────────────────────

test('the prospect pool is real cards with real art, never generated players', () => {
  const pool = prospectPool(cards, new Set(), SEED);
  assert.ok(pool.length > 100, `expected a deep pool, got ${pool.length}`);
  for (const card of pool.slice(0, 50)) {
    // Every prospect must be a genuine card: a generated one would have no
    // portrait, org or kit and would render as a hole.
    assert.ok(card.id && card.player && card.org, 'prospects must be real cards');
    assert.ok(card.rating <= PROSPECT_MAX_RATING, 'a prospect is not already a star');
  }
});

test('a prospect is drawn from outside the squad', () => {
  const squad = cards.filter(c => c.org).slice(0, 5);
  const excluded = new Set(squad.map(c => c.id));
  for (let seed = 0; seed < 30; seed++) {
    const prospect = rollYouthProspect(mulberry32(seed), cards, excluded, SEED);
    assert.ok(prospect, 'the academy must always find someone');
    assert.equal(excluded.has(prospect.cardId), false);
  }
});

test('a reset career clock is what makes them a prospect', () => {
  const prospect = rollYouthProspect(mulberry32(5), cards, new Set(), SEED);
  const card = cards.find(c => c.id === prospect.cardId);
  assert.equal(prospect.dev.p, 0, 'the clock must be zeroed');
  assert.equal(careerStage(SEED, card, prospect.dev), 'prospect');
});

test('a signed prospect actually develops into something', () => {
  const prospect = rollYouthProspect(mulberry32(5), cards, new Set(), SEED);
  const card = cards.find(c => c.id === prospect.cardId);
  const rng = mulberry32(1);
  let dev = prospect.dev;
  for (let y = 0; y < 5; y++) {
    dev = tickCareerYear(rng, SEED, card, dev, { yearsAtOrg: y, cohesion: 6, year: y }).dev;
  }
  assert.ok(dev.d >= 5, `five years should build a real player, got +${dev.d}`);
  // The anti-spiral promise: this path needs no titles and no packs.
  assert.ok(card.rating + dev.d >= 70, 'a developed prospect must become competitive');
});

test('the academy is deterministic for a seed', () => {
  assert.deepEqual(
    rollYouthProspect(mulberry32(9), cards, new Set(), SEED),
    rollYouthProspect(mulberry32(9), cards, new Set(), SEED),
  );
});

// ── NPC parity ──────────────────────────────────────────────────────────────

test('developCards leaves untouched cards identical, by reference', () => {
  const same = developCards(cards, {});
  assert.equal(same, cards, 'an empty dev map must not copy the pool');
  assert.equal(developCards(cards, null), cards);

  const dev = { [cards[0].id]: { d: 5 } };
  const out = developCards(cards, dev);
  assert.notEqual(out, cards);
  assert.equal(out[0].rating, cards[0].rating + 5);
  assert.equal(out[1], cards[1], 'undeveloped cards must not be reallocated');
});

test('the world ages: opponents are different teams years later', () => {
  const pool = tierPools(eligibleOrgs(cards, new Set()), cards)[1];
  const rng = mulberry32(77);
  let dev = {};
  for (let y = 0; y < 6; y++) dev = tickWorldYear(rng, SEED, pool, dev, { year: y });

  const moved = Object.values(dev).filter(d => d.d !== 0).length;
  assert.ok(moved > 50, `expected the world to move, only ${moved} players changed`);
  // Both directions: some orgs improve, some fade. A world that only decays
  // would just be a difficulty ramp with extra steps.
  assert.ok(Object.values(dev).some(d => d.d > 0), 'some NPCs must improve');
  assert.ok(Object.values(dev).some(d => d.d < 0), 'some NPCs must fade');
});

test('world state stays bounded so the save cannot run away', () => {
  const pool = tierPools(eligibleOrgs(cards, new Set()), cards)[0];
  const rng = mulberry32(3);
  let dev = {};
  for (let y = 0; y < 25; y++) dev = tickWorldYear(rng, SEED, pool, dev, { year: y });

  const tracked = Object.keys(dev).length;
  assert.ok(tracked <= MAX_TRACKED_ORGS * 5,
    `tracking ${tracked} players exceeds the cap`);
  assert.ok(JSON.stringify(dev).length < 60000, 'world dev must stay small enough to save');
});

test('a developed world reaches the bracket', () => {
  const picked = new Set();
  const before = endlessFieldPool(cards, picked, 1);
  const org = before[0];
  // Age that org's roster hard, then confirm the pool reflects it.
  const dev = Object.fromEntries(org.roster.map(p => [p.id, { ...emptyDev(p), d: -10 }]));
  const after = endlessFieldPool(cards, picked, 1, dev);

  // A faded roster may well drop OUT of its tier - that is the ladder working
  // on the world, not just on the player - so look across every tier.
  const anywhere = [0, 1, 2].flatMap(t => endlessFieldPool(cards, picked, t, dev));
  const sameOrgAfter = anywhere.find(o => o.id === org.id);
  assert.ok(sameOrgAfter, 'the org should still exist somewhere on the ladder');
  assert.ok(sameOrgAfter.power < org.power,
    `a faded roster must sim weaker (${org.power.toFixed(1)} -> ${sameOrgAfter.power.toFixed(1)})`);
  assert.equal(after.some(o => o.id === org.id), false,
    'and a heavy fade should cost it its place in the tier');
});

test('NPC ticking is deterministic for a seed', () => {
  const pool = tierPools(eligibleOrgs(cards, new Set()), cards)[2];
  const run = () => {
    const rng = mulberry32(11);
    let dev = {};
    for (let y = 0; y < 3; y++) dev = tickWorldYear(rng, SEED, pool, dev, { year: y });
    return dev;
  };
  assert.deepEqual(run(), run());
});
