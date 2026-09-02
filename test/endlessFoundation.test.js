import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import {
  buildBracket,
  eligibleOrgs,
  makeSeason,
  mulberry32,
  restoreRng,
  rngState,
  teamPower,
  todaySeed,
} from '../src/engine/perfectRun.js';

// ── RNG resumability ────────────────────────────────────────────────────────
// An endless run has to survive a reload, and replaying years of tournaments
// to catch back up is not an option. These pin the property that makes a
// one-integer save sufficient.

test('exposing rng state does not perturb the stream', () => {
  const withState = mulberry32(1234);
  const plain = mulberry32(1234);
  // Reimplementation of the original closure, to prove the refactor is a
  // pure addition rather than a subtly different generator.
  let a = 1234 >>> 0;
  const reference = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 1000; i++) {
    const value = withState();
    assert.equal(value, plain());
    assert.equal(value, reference());
  }
});

test('a saved rng state resumes the exact continuation of its stream', () => {
  const original = mulberry32(0xbeef);
  for (let i = 0; i < 137; i++) original(); // burn an arbitrary, odd number of calls

  const resumed = restoreRng(rngState(original));
  for (let i = 0; i < 1000; i++) {
    assert.equal(resumed(), original());
  }
});

test('rng state is a plain uint32, so it survives a JSON round trip', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 50; i++) rng();
  const state = rngState(rng);

  assert.equal(Number.isInteger(state), true);
  assert.ok(state >= 0 && state <= 0xffffffff);

  const revived = restoreRng(JSON.parse(JSON.stringify({ state })).state);
  assert.equal(revived(), rng());
});

test('rngState reports null for a generator that predates the state hook', () => {
  assert.equal(rngState(() => 0.5), null);
  assert.equal(rngState(null), null);
});

test('the daily seed is unchanged by the rng refactor', () => {
  // todaySeed hashes a date string and never touches generator internals, so
  // the same date must still produce the same first draws.
  const date = new Date(Date.UTC(2026, 0, 15));
  const first = mulberry32(todaySeed(date));
  const second = mulberry32(todaySeed(date));
  assert.deepEqual(
    Array.from({ length: 20 }, () => first()),
    Array.from({ length: 20 }, () => second()),
  );
});

// ── eligibleOrgs: signing a player must not delete their team ───────────────

test('drafting a player removes only that player, not their whole org', () => {
  const deepOrg = Object.entries(
    cards.reduce((byOrg, card) => {
      if (card.org) (byOrg[card.org] ??= []).push(card);
      return byOrg;
    }, {}),
  ).find(([, list]) => list.length >= 6);
  assert.ok(deepOrg, 'expected at least one org with a sixth player');

  const [orgId, list] = deepOrg;
  const star = [...list].sort((a, b) => b.rating - a.rating)[0];

  const before = eligibleOrgs(cards, new Set());
  const after = eligibleOrgs(cards, new Set([star.id]));

  const stillThere = after.find(org => org.id === orgId);
  assert.ok(stillThere, `${orgId} should survive losing one player`);
  assert.equal(before.length, after.length, 'org count is unchanged');
  assert.equal(stillThere.roster.some(p => p.id === star.id), false);
  assert.equal(stillThere.roster.length, 5);
});

test('an org without depth still drops out once it cannot field five', () => {
  const thinOrg = Object.entries(
    cards.reduce((byOrg, card) => {
      if (card.org) (byOrg[card.org] ??= []).push(card);
      return byOrg;
    }, {}),
  ).find(([, list]) => list.length === 5);
  assert.ok(thinOrg, 'expected at least one exactly-five-player org');

  const [orgId, list] = thinOrg;
  const after = eligibleOrgs(cards, new Set([list[0].id]));
  assert.equal(after.some(org => org.id === orgId), false);
});

test('no drafted player can appear on an opponent roster', () => {
  const roster = cards.filter(card => card.org).slice(0, 5);
  const picked = new Set(roster.map(card => card.id));
  const pool = eligibleOrgs(cards, picked);

  for (const org of pool) {
    for (const player of org.roster) {
      assert.equal(picked.has(player.id), false, `${player.player} is drafted but still on ${org.id}`);
    }
  }
});

// ── the player's team carries its IGL into NPC-resolved rounds ──────────────

test('every bracket team, the player included, carries an iglId', () => {
  const roster = cards.filter(card => !card.org).slice(0, 5);
  const iglId = roster[0].id;
  const player = {
    id: 'player', tag: 'YOU', name: 'GAUNTLET', roster, iglId,
    power: teamPower(roster, iglId).power, isPlayer: true,
  };
  const tour = buildBracket(mulberry32(42), cards, new Set(roster.map(c => c.id)), player, 'masters');

  assert.equal(tour.teams.player.iglId, iglId);
  assert.ok(Object.values(tour.teams).every(team => team.iglId));
});

test('bracket construction stays deterministic for a given seed', () => {
  const roster = cards.filter(card => !card.org).slice(0, 5);
  const player = {
    id: 'player', tag: 'YOU', name: 'GAUNTLET', roster, iglId: roster[0].id,
    power: teamPower(roster, roster[0].id).power, isPlayer: true,
  };
  const picked = new Set(roster.map(card => card.id));
  assert.deepEqual(
    buildBracket(mulberry32(2026), cards, picked, player, 'champions'),
    buildBracket(mulberry32(2026), cards, picked, player, 'champions'),
  );
});

// ── resume fidelity ─────────────────────────────────────────────────────────
// The endless autosave stores the rng state at the manage screen and does NOT
// serialize the bracket. That is only sound if restoring the generator and
// re-running the draw reproduces the same tournament, so pin it.

test('restoring the rng regenerates a byte-identical tournament', () => {
  const roster = cards.filter(card => !card.org).slice(0, 5);
  const picked = new Set(roster.map(c => c.id));
  const player = () => ({
    id: 'player', tag: 'YOU', name: 'GAUNTLET', roster, iglId: roster[0].id,
    power: teamPower(roster, roster[0].id).power, isPlayer: true,
  });

  const rng = mulberry32(0x5eed);
  // Burn the draft's worth of calls so the save point is mid-stream, not at
  // a seed boundary - the realistic case.
  for (let i = 0; i < 213; i++) rng();

  const saved = rngState(rng);
  const live = buildBracket(rng, cards, picked, player(), 'masters');

  // A reload: the run comes back from disk with only that integer.
  const resumed = buildBracket(restoreRng(saved), cards, picked, player(), 'masters');

  assert.deepEqual(resumed, live);
});

test('a resumed run continues the same schedule, not a fresh one', () => {
  const rng = mulberry32(31337);
  makeSeason(rng);                      // year 1, already played
  const saved = rngState(rng);

  const live = makeSeason(rng);         // year 2, drawn before the reload
  const resumed = makeSeason(restoreRng(saved));

  assert.deepEqual(resumed, live);
  assert.equal(new Set(resumed.map(e => e.city)).size, 3);
});

test('the save point survives a JSON round trip, as it does on disk', () => {
  const roster = cards.filter(card => !card.org).slice(0, 5);
  const picked = new Set(roster.map(c => c.id));
  const player = {
    id: 'player', tag: 'YOU', name: 'GAUNTLET', roster, iglId: roster[0].id,
    power: teamPower(roster, roster[0].id).power, isPlayer: true,
  };
  const rng = mulberry32(99);
  for (let i = 0; i < 40; i++) rng();

  const onDisk = JSON.parse(JSON.stringify({ rngState: rngState(rng) }));
  assert.deepEqual(
    buildBracket(restoreRng(onDisk.rngState), cards, picked, player, 'champions'),
    buildBracket(rng, cards, picked, player, 'champions'),
  );
});
