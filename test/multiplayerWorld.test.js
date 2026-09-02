// One shared world for an endless lobby.
//
// The design decision being pinned: competitors do NOT run parallel private
// worlds. There is one card pool, one development map and one market, so a
// player a rival develops or an org that fades is the same for everyone.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCompetitor, advanceDeadlines, applyCommand, buildMultiplayerBracket, createLobbyState,
  migrateLobbyState,
} from '../src/engine/multiplayer.js';
import { bondChemistry, bondKey, pruneBonds } from '../src/engine/endless/bonds.js';

// NOW_MONTH in the career model; a dated stint is what gives a card a real
// career clock. Spreading debuts across the pool matters: with no stints at
// all every fixture derives to the same age and nobody ever ages out, which
// silently makes a development test unable to observe decline.
const NOW_MONTH = 24319;

const cards = makeCards();

test('a new lobby starts with exactly one world', () => {
  const state = lobby(2, { gameLength: 'endless' });
  assert.deepEqual(state.world, { dev: {}, signedIds: {}, feed: [], year: 0 });
  assert.ok(state.competitors.every(c => c.bonds && Object.keys(c.bonds).length === 0));
});

test('a joining competitor gets their own bonds but shares the world', () => {
  const state = lobby(2, { gameLength: 'endless' });
  addCompetitor(state, { id: 'p3', squadName: 'Squad 3', now: 3 });
  const joined = state.competitors.find(c => c.id === 'p3');
  assert.deepEqual(joined.bonds, {});
  assert.equal(state.competitors.filter(c => c.bonds).length, 3);
  // ...and there is still only one world object.
  assert.equal(Object.keys(state).filter(k => k === 'world').length, 1);
});

test('development is shared: a rival’s player ages in the same map', () => {
  const state = lobby(2, { gameLength: 'endless' });
  seedRosters(state);
  const mine = state.competitors[0].rosterIds[0];
  const theirs = state.competitors[1].rosterIds[0];

  // A year of the shared world.
  state.world.dev[mine] = { d: -4, a: 0, m: 0, s: 0, p: 60, f: 0, cy: 1, yr: 1 };
  state.world.dev[theirs] = { d: 6, a: 0, m: 0, s: 0, p: 12, f: 0, cy: 1, yr: 1 };

  const bracket = buildMultiplayerBracket(state, cards, 'masters');
  const myTeam = bracket.teams[state.competitors[0].id];
  const theirTeam = bracket.teams[state.competitors[1].id];

  const raw = cards.find(c => c.id === mine).rating;
  assert.equal(myTeam.roster.find(c => c.id === mine).rating, raw - 4,
    'my faded player must sim faded');
  const theirRaw = cards.find(c => c.id === theirs).rating;
  assert.equal(theirTeam.roster.find(c => c.id === theirs).rating, theirRaw + 6,
    "a rival's developed player must sim developed, from the same map");
});

test('a signed player is off the board for every squad', () => {
  const state = lobby(2, { gameLength: 'endless' });
  seedRosters(state);
  const free = cards.find(c => c.org && !state.draftedCardIds.includes(c.id));

  const before = buildMultiplayerBracket(state, cards, 'masters');
  const beforeHas = Object.values(before.teams)
    .some(team => team.roster?.some(c => c.id === free.id));
  assert.equal(beforeHas, true, 'the card should start out available');

  state.world.signedIds[free.id] = 'RIVAL';
  const after = buildMultiplayerBracket(state, cards, 'masters');
  const afterHas = Object.values(after.teams)
    .some(team => team.roster?.some(c => c.id === free.id));
  assert.equal(afterHas, false, 'once signed, nobody can field them');
});

test('chemistry is private even though development is shared', () => {
  const state = lobby(2, { gameLength: 'endless' });
  seedRosters(state);
  const [a, b] = state.competitors;
  a.bonds = { [bondKey(a.rosterIds[0], a.rosterIds[1])]: 6 };

  const bracket = buildMultiplayerBracket(state, cards, 'masters');
  const rosterA = bracket.teams[a.id].roster;
  const rosterB = bracket.teams[b.id].roster;

  assert.ok(bondChemistry(a.bonds, rosterA).total > 0, 'my core has a bond');
  assert.equal(bondChemistry(b.bonds ?? {}, rosterB).total, 0, "a rival does not inherit it");
});

test('a swapped-out player takes their chemistry with them', () => {
  const state = lobby(2, { gameLength: 'endless', unboxing: 'normal' });
  seedRosters(state);
  const me = state.competitors[0];
  const [x, y] = me.rosterIds;
  me.bonds = { [bondKey(x, y)]: 6 };

  // Simulate the swap bookkeeping chooseSwap performs.
  const incoming = cards.find(c => !state.draftedCardIds.includes(c.id));
  me.rosterIds[0] = incoming.id;
  me.bonds = pruneBonds(me.bonds, me.rosterIds);
  assert.deepEqual(me.bonds, {}, 'the bond leaves with the player');
});

test('an in-flight v1 lobby gains the world without losing its run', () => {
  const state = lobby(3, { gameLength: 'endless' });
  seedRosters(state);
  state.schemaVersion = 1;
  delete state.world;
  for (const c of state.competitors) delete c.bonds;
  const rosters = state.competitors.map(c => [...c.rosterIds]);

  const migrated = migrateLobbyState(state);
  assert.deepEqual(migrated.world, { dev: {}, signedIds: {}, feed: [], year: 0 });
  migrated.competitors.forEach((c, i) => {
    assert.deepEqual(c.rosterIds, rosters[i], 'the run itself must be untouched');
    assert.deepEqual(c.bonds, {});
  });
});

test('the shared world keeps the lobby deterministic from its seed', () => {
  const play = () => {
    const state = lobby(2, { gameLength: 'endless' });
    run(state, 'start_game', 'p1', {}, 100);
    let guard = 0;
    while (state.phase === 'draft' && guard++ < 80) {
      const actor = state.draft.activeCompetitorId;
      const pick = state.draft.offers?.[0];
      if (!actor || !pick) break;
      run(state, 'choose_card', actor, { cardId: pick }, 100 + guard);
    }
    return { drafted: state.draftedCardIds, counter: state.rngCounter, world: state.world };
  };
  assert.deepEqual(play(), play(), 'the same seed must produce the same lobby');
});

// ── helpers ─────────────────────────────────────────────────────────────────

function run(state, type, actorId, payload, now) {
  return applyCommand(state, actorId, {
    type, commandId: `${type}:${now}:${state.version}`,
    expectedVersion: state.version, payload,
  }, cards, now);
}

function lobby(count, overrides = {}) {
  const state = createLobbyState({
    code: 'ABC234', hostId: 'p1', squadName: 'Squad 1', seed: 123,
    settings: { gameLength: 'year', unboxing: 'normal', ...overrides }, now: 0,
  });
  for (let i = 2; i <= count; i++) addCompetitor(state, { id: `p${i}`, squadName: `Squad ${i}`, now: i });
  return state;
}

function seedRosters(state) {
  const free = cards.filter(card => !card.org).slice(0, state.competitors.length * 5);
  state.competitors.forEach((player, index) => {
    player.rosterIds = free.slice(index * 5, index * 5 + 5).map(card => card.id);
    player.iglId = player.rosterIds[0];
  });
  state.draftedCardIds = state.competitors.flatMap(player => player.rosterIds);
}

function makeCards() {
  const output = [];
  const nations = ['US', 'CA', 'BR', 'ID'];
  for (let i = 0; i < 100; i++) output.push(card(`free-${i}`, 70 + i % 25, nations[i % nations.length], null, i));
  for (let org = 0; org < 40; org++) {
    for (let member = 0; member < 5; member++) {
      output.push(card(`org-${org}-${member}`, 99 - org * 0.5 - member * 0.01, nations[org % nations.length], `ORG${org}`, org * 5 + member));
    }
  }
  return output;
}

function card(id, rating, nationality, org, index = 0) {
  const yearsPro = index % 7;           // 0..6 years, so the pool spans prospect..veteran
  return {
    id, player: id, rating, nationality, org, org_name: org, org_logo: null,
    role: ['Duelist', 'Initiator', 'Controller', 'Sentinel'][id.length % 4],
    igl: id.endsWith('0'), tier: 'silver', league: 't2',
    stints: [{ org: org ?? 'FA', from: NOW_MONTH - yearsPro * 12, to: null }],
    stats: { aim: rating, positioning: rating, ability: rating, mentality: rating, synergy: rating },
  };
}

// ── the world actually turns ────────────────────────────────────────────────

/** Drive a lobby forward on deadlines alone, up to `stop`. */
function playUntil(state, stop, limit = 600) {
  let guard = 0;
  while (!stop(state) && guard++ < limit) {
    const at = state.phase === 'draft' || state.phase === 'igl_select' ? state.draft?.deadlineAt
      : state.phase === 'consolation' ? state.consolation?.deadlineAt
        : state.pendingTransition?.deadlineAt;
    if (at == null) break;
    advanceDeadlines(state, cards, at);
  }
  return state;
}

test('a completed year turns the shared world', () => {
  const state = lobby(2, { gameLength: 'endless' });
  run(state, 'start_game', 'p1', {}, 100);
  playUntil(state, s => (s.world.year ?? 0) >= 1);

  assert.equal(state.world.year, 1, 'a year should have been settled');
  assert.ok(Object.keys(state.world.dev).length > 0, 'drafted players must have developed');

  // Only cards someone actually owns are tracked - the world does not carry
  // a dev entry for every card in the game.
  const drafted = new Set(state.draftedCardIds);
  for (const id of Object.keys(state.world.dev)) {
    assert.equal(drafted.has(id), true, `${id} is tracked but nobody owns them`);
  }
});

test('a year of the shared world moves players in both directions', () => {
  const state = lobby(4, { gameLength: 'endless' });
  run(state, 'start_game', 'p1', {}, 100);
  playUntil(state, s => (s.world.year ?? 0) >= 2);

  const drifts = Object.values(state.world.dev).map(d => d.d ?? 0);
  assert.ok(drifts.some(d => d > 0), 'someone must be improving');
  assert.ok(drifts.some(d => d < 0), 'someone must be fading');
});

test('squads build their own chemistry as events are played', () => {
  const state = lobby(2, { gameLength: 'endless' });
  run(state, 'start_game', 'p1', {}, 100);
  playUntil(state, s => (s.season?.results?.length ?? 0) >= 2);

  for (const competitor of state.competitors) {
    const strengths = Object.values(competitor.bonds ?? {});
    assert.ok(strengths.length > 0, `${competitor.id} should have formed bonds`);
    assert.ok(strengths.every(v => v > 0));
  }
  // Bonds are per squad, so two competitors must not share a key set.
  const [a, b] = state.competitors;
  const shared = Object.keys(a.bonds).filter(k => k in b.bonds);
  assert.equal(shared.length, 0, 'bonds must not leak between squads');
});

test('an endless lobby stays byte-identical for a seed, world included', () => {
  const play = () => {
    const state = lobby(2, { gameLength: 'endless' });
    run(state, 'start_game', 'p1', {}, 100);
    playUntil(state, s => (s.world.year ?? 0) >= 1);
    return { world: state.world, rngCounter: state.rngCounter, drafted: state.draftedCardIds };
  };
  assert.deepEqual(play(), play());
});

test('a Year lobby is left completely alone by the world systems', () => {
  const state = lobby(2, { gameLength: 'year' });
  run(state, 'start_game', 'p1', {}, 100);
  playUntil(state, s => s.phase === 'season_over');

  assert.equal(state.phase, 'season_over');
  assert.equal(state.world.year, 0, 'a fixed year must not tick the world');
  assert.deepEqual(state.world.dev, {}, 'and must not develop anyone');
  assert.deepEqual(state.world.signedIds, {});
});
