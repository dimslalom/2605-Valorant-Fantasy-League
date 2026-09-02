import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import {
  buildBracket,
  evaluateEndless,
  evaluateSeason,
  makeSeason,
  mulberry32,
  teamPower,
} from '../src/engine/perfectRun.js';
import { migratePerfectRunSaves } from '../src/lib/perfectRunSaves.js';

function tournament(champion, mapsLost = 0) {
  return {
    champion,
    series: [
      { won: true, mapsWon: 2, mapsLost, roundDiff: 8 },
      { won: champion, mapsWon: champion ? 2 : 1, mapsLost: champion ? 0 : 2, roundDiff: champion ? 6 : -4 },
    ],
  };
}

test('Endless years use the exact normal Masters, Masters, Champions schedule builder', () => {
  const firstYear = makeSeason(mulberry32(77));
  const fourthTournamentYear = makeSeason(mulberry32(77));
  assert.deepEqual(firstYear, fourthTournamentYear);
  assert.deepEqual(firstYear.map(event => event.kind), ['masters', 'masters', 'champions']);
  assert.equal(new Set(firstYear.map(event => event.city)).size, 3);
});

test('Endless sums the standard score independently for every year', () => {
  const results = [
    tournament(true), tournament(true), tournament(true),
    tournament(true, 1), tournament(false), tournament(true),
  ];
  const first = evaluateSeason(results.slice(0, 3));
  const second = evaluateSeason(results.slice(3, 6));
  const endless = evaluateEndless(results);

  assert.equal(endless.score, first.score + second.score);
  assert.equal(endless.completedYears, 2);
  assert.equal(endless.years[0].grandSlam, true);
  assert.equal(endless.years[0].perfectSeason, true);
  assert.equal(endless.years[1].grandSlam, false);
  // Badges are objects, not strings, and endless prefixes each year's label.
  assert.ok(endless.badges.some(b => b.key === 'year_1_grand_slam' && b.label === 'YEAR 1 · GRAND SLAM'));
  // Only completed years contribute badges, so the unfinished year 3 adds none.
  assert.ok(endless.badges.every(b => b.key.startsWith('year_1_') || b.key.startsWith('year_2_')));
});

test('tournament four uses the normal bracket builder and retains the squad', () => {
  const roster = cards.filter(card => !card.org).slice(0, 5);
  const player = {
    id: 'player', tag: 'YOU', name: 'GAUNTLET', roster,
    iglId: roster[0].id, power: teamPower(roster, roster[0].id).power, isPlayer: true,
  };
  const picked = new Set(roster.map(card => card.id));
  const first = buildBracket(mulberry32(42), cards, picked, player, 'masters');
  const fourth = buildBracket(mulberry32(42), cards, picked, player, 'masters');

  assert.deepEqual(fourth, first);
  assert.deepEqual(fourth.teams.player.roster.map(card => card.id), roster.map(card => card.id));
  assert.ok(Object.values(fourth.teams).every(team => Number.isFinite(team.power)));
  assert.ok(Object.values(fourth.teams).every(team => team.iglId));
});

test('legacy Endless records are archived while V2 starts a comparable record', () => {
  const migrated = migratePerfectRunSaves({ bestEndless: 1234, bestCycle: 5, grandSlams: 2 });
  assert.deepEqual(migrated.legacyEndlessV1, { bestScore: 1234, bestCycle: 5 });
  assert.deepEqual(migrated.endlessV2, { bestScore: 0, bestYears: 0 });
  assert.equal(migrated.grandSlams, 2);
  assert.equal('bestEndless' in migrated, false);
  assert.equal('bestCycle' in migrated, false);
});
