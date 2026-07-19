import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CITIES,
  PACK_SIZE,
  evaluateSeason,
  mulberry32,
  nextEndlessEvent,
  samplePack,
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
