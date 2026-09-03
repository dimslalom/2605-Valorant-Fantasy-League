import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { mulberry32 } from '../src/engine/perfectRun.js';
import {
  TACTIC_HAND_MAX, changedMapCards, consumeTactic, gainMapMastery, mapActivation,
  mapCardsForYear, npcTactic, npcTacticChoices, refillTacticHand, tacticActivation,
  tacticBooster, tacticClash,
} from '../src/engine/endless/seriesCards.js';

const roster = cards.filter(card => card.org).slice(0, 5);

test('exactly three map rule stickers change after year one', () => {
  assert.equal(changedMapCards(4242, 1).length, 0);
  assert.equal(changedMapCards(4242, 2).length, 3);
  assert.equal(changedMapCards(4242, 8).length, 3);
  assert.deepEqual(mapCardsForYear(4242, 4), mapCardsForYear(4242, 4));
});

test('map rules are symmetric data and activate from roster composition', () => {
  const map = mapCardsForYear(4242, 2)[0];
  const first = mapActivation(roster, map, 0);
  const second = mapActivation(roster, map, 0);
  assert.deepEqual(first, second);
  assert.ok(first.bonus >= 0);
  assert.ok(first.activeIds.every(id => roster.some(card => card.id === id)));
});

test('mastery grows visibly but stays capped', () => {
  let mastery = {};
  for (let i = 0; i < 20; i++) mastery = gainMapMastery(mastery, 'Bind');
  assert.equal(mastery.Bind, 6);
});

test('the IGL only refills a tactic hand to the two-card floor', () => {
  const rng = mulberry32(12);
  const map = mapCardsForYear(1, 1)[0];
  const empty = refillTacticHand(rng, [], { roster, map });
  assert.equal(empty.length, 2);
  const full = tacticBooster(rng, TACTIC_HAND_MAX);
  assert.equal(refillTacticHand(rng, full, { roster, map }).length, TACTIC_HAND_MAX);
  assert.deepEqual(refillTacticHand(rng, full, { roster, map }), full);
});

test('the opponent visibly holds two calls and chooses the stronger one', () => {
  const map = mapCardsForYear(7, 1)[0];
  const choices = npcTacticChoices(mulberry32(77), roster, map);
  assert.equal(choices.length, 2);
  assert.deepEqual(npcTactic(mulberry32(77), roster, map), choices[0]);
  const activations = choices.map(card => tacticActivation(card, roster, mapActivation(roster, map, 0)).bonus);
  assert.ok(activations[0] >= activations[1]);
});

test('played tactics are consumed while duplicates remain separate uses', () => {
  const rng = mulberry32(91);
  const [card] = tacticBooster(rng, 1);
  const hand = [card, { ...card, uid: `${card.uid}-copy` }];
  const next = consumeTactic(hand, card.uid);
  assert.equal(next.length, 1);
  assert.equal(next[0].key, card.key);
});

test('tactics activate cards and soft counters never cancel the loser', () => {
  const map = mapCardsForYear(2, 1)[0];
  const mapResult = mapActivation(roster, map, 0);
  const tempo = tacticActivation({ key: 'hit' }, roster, mapResult);
  const read = tacticActivation({ key: 'pocket' }, roster, mapResult);
  const clash = tacticClash(tempo, read);
  assert.ok(tempo.bonus > 0);
  assert.ok(read.bonus > 0);
  assert.equal(clash.player, 0.8);
  assert.equal(clash.opponent, 0);
});
