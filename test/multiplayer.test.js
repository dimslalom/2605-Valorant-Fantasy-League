import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFT_DEADLINE_MS,
  GameError,
  addCompetitor,
  advanceDeadlines,
  applyCommand,
  buildMultiplayerBracket,
  createLobbyState,
  makeSnakeOrder,
  nextAlarmAt,
  setConnection,
} from '../src/engine/multiplayer.js';

const cards = makeCards();

test('snake order reverses every round', () => {
  assert.deepEqual(
    makeSnakeOrder(['a', 'b', 'c'], 3).map(turn => turn.competitorId),
    ['a', 'b', 'c', 'c', 'b', 'a', 'a', 'b', 'c'],
  );
});

for (const count of [2, 3, 8, 15, 16]) {
  test(`${count} humans produce a seeded 16-team field`, () => {
    const state = lobbyWithPlayers(count);
    seedRosters(state);
    const bracket = buildMultiplayerBracket(state, cards, 'masters');
    assert.equal(bracket.seeds.length, 16);
    assert.equal(Object.values(bracket.teams).filter(team => team.human).length, count);
    assert.equal(Object.values(bracket.teams).filter(team => !team.human).length, 16 - count);
    const seeds = bracket.seeds;
    assert.deepEqual(bracket.rounds[0].matches.slice(0, 2).map(m => [m.a, m.b]), [
      [seeds[0], seeds[15]],
      [seeds[7], seeds[8]],
    ]);
  });
}

test('Champions takes the strongest eligible NPCs', () => {
  const state = lobbyWithPlayers(2);
  seedRosters(state);
  const bracket = buildMultiplayerBracket(state, cards, 'champions');
  const npcPowers = Object.values(bracket.teams).filter(team => !team.human).map(team => team.power).sort((a, b) => b - a);
  assert.deepEqual(npcPowers, [...npcPowers].sort((a, b) => b - a));
  assert.equal(npcPowers.length, 14);
});

test('normal snake draft is globally exclusive and times out to the best offer', () => {
  const state = lobbyWithPlayers(2);
  run(state, 'start_game', 'p1', {}, cards, 100);
  assert.equal(state.phase, 'draft');
  assert.equal(state.draft.offers.length, 3);
  const offerCards = state.draft.offers.map(id => cards.find(card => card.id === id));
  const expected = [...offerCards].sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))[0].id;
  advanceDeadlines(state, cards, state.draft.deadlineAt);
  assert.equal(state.draftedCardIds[0], expected);
  assert.equal(new Set(state.draftedCardIds).size, state.draftedCardIds.length);
});

test('ENC offers every available card from one nation', () => {
  const state = lobbyWithPlayers(2, { unboxing: 'enc' });
  run(state, 'start_game', 'p1', {}, cards, 100);
  assert.ok(state.draft.nation);
  assert.ok(state.draft.offers.length > 3);
  assert.ok(state.draft.offers.every(id => cards.find(card => card.id === id).nationality === state.draft.nation));
});

test('duplicate and stale commands cannot duplicate a draft pick', () => {
  const state = lobbyWithPlayers(2);
  run(state, 'start_game', 'p1', {}, cards, 100);
  const actor = state.draft.activeCompetitorId;
  const command = { type: 'choose_card', commandId: 'same', expectedVersion: state.version, payload: { cardId: state.draft.offers[0] } };
  applyCommand(state, actor, command, cards, 101);
  const count = state.draftedCardIds.length;
  assert.equal(applyCommand(state, actor, command, cards, 102).duplicate, true);
  assert.equal(state.draftedCardIds.length, count);
  assert.throws(() => applyCommand(state, state.draft.activeCompetitorId, { ...command, commandId: 'stale' }, cards, 103), error => error instanceof GameError && error.code === 'stale_version');
});

test('consolation swap releases the old card and repairs a replaced IGL', () => {
  const state = lobbyWithPlayers(2);
  seedRosters(state);
  const oldIgl = state.competitors[0].iglId;
  const replacement = cards.find(card => !state.draftedCardIds.includes(card.id)).id;
  state.phase = 'consolation';
  state.consolation = {
    order: ['p1', 'p2'], turnIndex: 0, activeCompetitorId: 'p1', offers: [replacement],
    nation: null, selectedCardId: null, deadlineAt: DRAFT_DEADLINE_MS,
  };
  run(state, 'choose_card', 'p1', { cardId: replacement }, cards, 10);
  run(state, 'choose_swap', 'p1', { replaceCardId: oldIgl }, cards, 11);
  assert.equal(state.draftedCardIds.includes(oldIgl), false);
  assert.equal(state.draftedCardIds.includes(replacement), true);
  assert.equal(state.competitors[0].rosterIds.includes(replacement), true);
  assert.notEqual(state.competitors[0].iglId, oldIgl);
});

test('host controls migrate to the earliest connected competitor after 30 seconds', () => {
  const state = lobbyWithPlayers(3);
  setConnection(state, 'p2', true, 5);
  setConnection(state, 'p3', true, 6);
  setConnection(state, 'p1', false, 10);
  assert.equal(state.hostId, 'p1');
  advanceDeadlines(state, cards, state.hostMigrationAt);
  assert.equal(state.hostId, 'p2');
});

test('human matches wait for the host before revealing a score', () => {
  const state = lobbyWithPlayers(2);
  seedRosters(state);
  state.draft = { seatOrder: state.competitors.map(player => player.id) };
  state.season = {
    cycle: 0,
    eventIndex: 0,
    events: [{ kind: 'masters', city: 'London', label: 'Masters London' }],
    standings: Object.fromEntries(state.competitors.map(player => [player.id, {
      competitorId: player.id, squadName: player.squadName,
      titles: 0, matchWins: 0, mapsWon: 0, mapsLost: 0, score: 0,
    }])),
  };
  state.tournament = { ...buildMultiplayerBracket(state, cards, 'masters'), meta: state.season.events[0], championId: null };
  const firstHuman = state.tournament.rounds[0].matches.find(match => match.humanInvolved);
  state.tournament.currentHumanMatchId = firstHuman.id;
  state.phase = 'match_ready';

  assert.equal(firstHuman.winner, null);
  run(state, 'play_match', 'p1', {}, cards, 100);
  assert.ok(firstHuman.winner);
  assert.ok(firstHuman.maps?.length);
  assert.equal(state.phase, 'match_transition');
  assert.equal(state.pendingTransition.matchId, firstHuman.id);
  assert.equal(nextAlarmAt(state), state.pendingTransition.deadlineAt);
});

test('Year reaches standings and skips final Champions consolation', () => {
  const state = lobbyWithPlayers(2);
  run(state, 'start_game', 'p1', {}, cards, 100);
  let now;
  let guard = 0;
  while (state.phase !== 'season_over' && guard++ < 500) {
    if (state.phase === 'draft') {
      now = state.draft.deadlineAt;
      advanceDeadlines(state, cards, now);
    } else if (state.phase === 'igl_select') {
      now = state.draft.deadlineAt;
      advanceDeadlines(state, cards, now);
    } else if (state.phase === 'match_transition') {
      now = state.pendingTransition.deadlineAt;
      advanceDeadlines(state, cards, now);
    } else if (state.phase === 'match_ready') {
      now += 1;
      run(state, 'play_match', 'p1', {}, cards, now);
    } else if (state.phase === 'consolation') {
      now = state.consolation.deadlineAt;
      advanceDeadlines(state, cards, now);
    } else {
      throw new Error(`Unexpected phase ${state.phase}`);
    }
  }
  assert.equal(state.phase, 'season_over');
  assert.equal(state.season.results.length, 3);
  assert.equal(state.season.results[2].label.startsWith('Champions '), true);
  assert.equal(state.consolation, null);
});

test('Endless end request finishes the current event and its consolation first', () => {
  const state = lobbyWithPlayers(2, { gameLength: 'endless' });
  run(state, 'start_game', 'p1', {}, cards, 100);
  let now = 100;
  let requested = false;
  let sawConsolation = false;
  let guard = 0;
  while (state.phase !== 'season_over' && guard++ < 300) {
    if (state.phase === 'draft' || state.phase === 'igl_select') {
      now = state.draft.deadlineAt;
      advanceDeadlines(state, cards, now);
    } else if (state.phase === 'match_transition') {
      if (!requested) {
        run(state, 'end_endless', 'p1', {}, cards, now + 1);
        requested = true;
      }
      now = state.pendingTransition.deadlineAt;
      advanceDeadlines(state, cards, now);
    } else if (state.phase === 'match_ready') {
      now += 1;
      run(state, 'play_match', 'p1', {}, cards, now);
    } else if (state.phase === 'consolation') {
      sawConsolation = true;
      now = state.consolation.deadlineAt;
      advanceDeadlines(state, cards, now);
    } else {
      throw new Error(`Unexpected phase ${state.phase}`);
    }
  }
  assert.equal(requested, true);
  assert.equal(sawConsolation, true);
  assert.equal(state.phase, 'season_over');
  assert.equal(state.season.results.length, 1);
});

function run(state, type, actorId, payload, gameCards, now) {
  return applyCommand(state, actorId, {
    type,
    commandId: `${type}:${now}:${state.version}`,
    expectedVersion: state.version,
    payload,
  }, gameCards, now);
}

function lobbyWithPlayers(count, overrides = {}) {
  const state = createLobbyState({
    code: 'ABC234', hostId: 'p1', squadName: 'Squad 1', seed: 123,
    settings: { gameLength: 'year', unboxing: 'normal', ...overrides }, now: 0,
  });
  for (let i = 2; i <= count; i++) addCompetitor(state, { id: `p${i}`, squadName: `Squad ${i}`, now: i });
  return state;
}

function seedRosters(state) {
  const humans = cards.filter(card => !card.org).slice(0, state.competitors.length * 5);
  state.competitors.forEach((player, index) => {
    player.rosterIds = humans.slice(index * 5, index * 5 + 5).map(card => card.id);
    player.iglId = player.rosterIds[0];
  });
  state.draftedCardIds = state.competitors.flatMap(player => player.rosterIds);
}

function makeCards() {
  const output = [];
  const nations = ['US', 'CA', 'BR', 'ID'];
  for (let i = 0; i < 100; i++) output.push(card(`free-${i}`, 70 + i % 25, nations[i % nations.length], null));
  for (let org = 0; org < 40; org++) {
    for (let member = 0; member < 5; member++) output.push(card(`org-${org}-${member}`, 99 - org * .5 - member * .01, nations[org % nations.length], `ORG${org}`));
  }
  return output;
}

function card(id, rating, nationality, org) {
  return {
    id, player: id, rating, nationality, org, org_name: org, org_logo: null,
    role: ['Duelist', 'Initiator', 'Controller', 'Sentinel'][id.length % 4],
    igl: id.endsWith('0'), stints: [], stats: { aim: rating, positioning: rating, ability: rating, mentality: rating, synergy: rating },
  };
}
