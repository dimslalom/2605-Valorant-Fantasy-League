import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CITIES,
  PACK_SIZE,
  evaluateSeason,
  mulberry32,
  nextEndlessEvent,
  samplePack,
  buildCpuNationalTeam,
  buildNationalBracket,
  currentRound,
  eligibleNationalPools,
  nextBracketRound,
  resolveNpcMatches,
  resolveTournamentToChampion,
  teamPower,
  updateEncRecords,
} from '../src/engine/perfectRun.js';

const cards = Array.from({ length: 12 }, (_, index) => ({
  id: `card-${index + 1}`,
  rating: 70 + index,
}));

test('normal packs contain five distinct available cards and are deterministic', () => {
  const picked = new Set(['card-1', 'card-2']);
  const first = samplePack(mulberry32(12345), cards, picked);
  const second = samplePack(mulberry32(12345), cards, picked);

  assert.equal(first.length, PACK_SIZE);
  assert.equal(new Set(first.map(card => card.id)).size, PACK_SIZE);
  assert.ok(first.every(card => !picked.has(card.id)));
  assert.deepEqual(first.map(card => card.id), second.map(card => card.id));
  assert.deepEqual(first.map(card => card.rating), [...first].map(card => card.rating).sort((a, b) => b - a));
});

test('endless events ramp to Champions fields and avoid recent cities', () => {
  const used = CITIES.slice(0, 10);
  const first = nextEndlessEvent(mulberry32(7), 0, used);
  const second = nextEndlessEvent(mulberry32(8), 1, used);
  const third = nextEndlessEvent(mulberry32(9), 2, used);

  assert.equal(first.kind, 'masters');
  assert.equal(second.kind, 'masters');
  assert.equal(third.kind, 'champions');
  assert.ok(!used.includes(first.city));
  assert.ok(!used.includes(second.city));
  assert.ok(!used.includes(third.city));
});

test('endless summaries suppress fixed-season badges and report event count', () => {
  const results = Array.from({ length: 3 }, () => ({
    champion: true,
    series: [{ won: true, mapsWon: 2, mapsLost: 0, roundDiff: 8 }],
  }));
  const season = evaluateSeason(results);
  const endless = evaluateSeason(results, { endless: true });

  assert.equal(season.grandSlam, true);
  assert.equal(season.perfectSeason, true);
  assert.equal(endless.grandSlam, false);
  assert.equal(endless.perfectSeason, false);
  assert.equal(endless.events, 3);
  assert.ok(endless.score < season.score);
  assert.deepEqual(endless.badges, []);
});

test('season scores never fall below zero after a heavy loss', () => {
  const result = evaluateSeason([{
    champion: false,
    series: [{ won: false, mapsWon: 0, mapsLost: 2, roundDiff: -22 }],
  }]);

  assert.equal(result.score, 0);
});

const roles = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];

function nationalCards(countryCount = 34, playersPerCountry = 7) {
  return Array.from({ length: countryCount }, (_, countryIndex) =>
    Array.from({ length: playersPerCountry }, (_, playerIndex) => ({
      id: `N${countryIndex}-${playerIndex}`,
      player: `Player ${countryIndex}-${playerIndex}`,
      nationality: `N${String(countryIndex).padStart(2, '0')}`,
      role: roles[playerIndex % roles.length],
      rating: 60 + countryIndex + playerIndex,
      igl: playerIndex === 1,
      org: null,
      stints: [],
      stats: { aim: 75 },
    })),
  ).flat();
}

test('ENC eligibility requires seven cards and excludes the UN fallback', () => {
  const cards = [
    ...nationalCards(2, 7),
    ...Array.from({ length: 6 }, (_, i) => ({ ...nationalCards(1, 7)[i], id: `short-${i}`, nationality: 'SHORT' })),
    ...Array.from({ length: 8 }, (_, i) => ({ ...nationalCards(1, 7)[i % 7], id: `un-${i}`, nationality: 'UN' })),
  ];
  const pools = eligibleNationalPools(cards);

  assert.deepEqual(pools.map(pool => pool.nationality), ['N00', 'N01']);
  assert.ok(pools.every(pool => pool.cards.length === 7));
});

test('CPU national rosters are unique, role-balanced, and use their strongest IGL assignment', () => {
  const pool = nationalCards(1, 9);
  const team = buildCpuNationalTeam('N00', pool);
  const bestPower = Math.max(...team.roster.map(card => teamPower(team.roster, card.id).power));

  assert.equal(team.roster.length, 5);
  assert.equal(new Set(team.roster.map(card => card.id)).size, 5);
  assert.ok(roles.every(role => team.roster.some(card => card.role === role)));
  assert.ok(team.roster.every(card => card.nationality === 'N00'));
  assert.equal(team.power, bestPower);
});

test('34 ENC nations produce two preliminaries and a 32-team main bracket', () => {
  const cards = nationalCards();
  const playerPool = cards.filter(card => card.nationality === 'N00');
  const tournament = buildNationalBracket(cards, 'N00', playerPool.slice(0, 5), playerPool[1].id);

  assert.equal(Object.keys(tournament.teams).length, 34);
  assert.equal(new Set(tournament.seeds).size, 34);
  assert.equal(currentRound(tournament).key, 'preliminary');
  assert.equal(currentRound(tournament).matches.length, 2);

  resolveNpcMatches(tournament, mulberry32(10));
  nextBracketRound(tournament);
  assert.equal(currentRound(tournament).key, 'r32');
  assert.equal(currentRound(tournament).matches.length, 16);
});

test('ENC preliminary generation adapts to a different eligible field size', () => {
  const cards = nationalCards(20);
  const playerPool = cards.filter(card => card.nationality === 'N19');
  const tournament = buildNationalBracket(cards, 'N19', playerPool.slice(2, 7), playerPool[2].id);

  assert.equal(tournament.mainSize, 16);
  assert.equal(currentRound(tournament).matches.length, 4);
});

test('the selected player roster controls its seed and eliminated runs still crown one nation', () => {
  const cards = nationalCards();
  const playerPool = cards.filter(card => card.nationality === 'N00');
  const boosted = playerPool.slice(0, 5).map(card => ({ ...card, rating: 99 }));
  const tournament = buildNationalBracket(cards, 'N00', boosted, boosted[1].id);

  assert.equal(tournament.seeds[0], 'player');
  resolveNpcMatches(tournament, mulberry32(20));
  nextBracketRound(tournament);
  const match = currentRound(tournament).matches.find(item => item.isPlayerMatch);
  match.winner = match.a === 'player' ? match.b : match.a;
  const champion = resolveTournamentToChampion(tournament, mulberry32(21));

  assert.ok(champion);
  assert.equal(currentRound(tournament).key, 'final');
  assert.equal(currentRound(tournament).matches[0].winner, champion);
});

test('ENC records update independently and preserve the strongest finish', () => {
  const first = updateEncRecords({}, {
    series: [{ won: true }, { won: false }], champion: false, mapsLost: 2, finishRound: 'Round of 16',
  });
  const title = updateEncRecords(first, {
    series: Array.from({ length: 5 }, () => ({ won: true })), champion: true, mapsLost: 0, finishRound: 'Grand Final',
  });
  const laterLoss = updateEncRecords(title, {
    series: [{ won: false }], champion: false, mapsLost: 2, finishRound: 'Round of 32',
  });

  assert.deepEqual(title, { bestWins: 5, bestFinish: 'Champion', titles: 1, flawless: 1 });
  assert.equal(laterLoss.bestFinish, 'Champion');
  assert.equal(laterLoss.titles, 1);
  assert.equal(laterLoss.flawless, 1);
});
