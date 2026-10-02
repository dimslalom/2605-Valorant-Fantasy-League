import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { mulberry32 } from '../src/engine/perfectRun.js';
import {
  TACTIC_HAND_MAX, bankTactics, changedMapCards, consumeTactic, gainMapMastery, mapActivation,
  mapCardsForYear, mapPicksPerSide, npcTactic, npcTacticChoices, refillTacticHand, settleTactic, tacticActivation,
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

test('bankTactics fits a reward pick, cap 7', () => {
  assert.equal(TACTIC_HAND_MAX, 7);
  const rng = mulberry32(5);
  const hand = tacticBooster(rng, 3);
  const incoming = tacticBooster(rng, 2);
  const { hand: next, overflow } = bankTactics(hand, incoming);
  assert.equal(next.length, 5);
  assert.equal(overflow.length, 0);
  assert.deepEqual(next.slice(3), incoming);
});

test('bankTactics overflows past the cap, one and two over', () => {
  const rng = mulberry32(6);
  const full = tacticBooster(rng, TACTIC_HAND_MAX);
  const one = tacticBooster(rng, 1);
  const oneOver = bankTactics(full, one);
  assert.equal(oneOver.hand.length, TACTIC_HAND_MAX);
  assert.deepEqual(oneOver.hand, full);
  assert.deepEqual(oneOver.overflow, one);

  const nearFull = full.slice(0, TACTIC_HAND_MAX - 1);
  const two = tacticBooster(rng, 2);
  const twoOver = bankTactics(nearFull, two);
  assert.equal(twoOver.hand.length, TACTIC_HAND_MAX);
  assert.equal(twoOver.overflow.length, 1);
  assert.deepEqual(twoOver.overflow[0], two[1]);
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

test('a tactic comes back after a won map and burns after a lost one', () => {
  const rng = mulberry32(44);
  const [played, other] = tacticBooster(rng, 2);
  const afterPlay = consumeTactic([played, other], played.uid);
  assert.deepEqual(settleTactic(afterPlay, played, true), [other, played]);
  assert.deepEqual(settleTactic(afterPlay, played, false), [other]);
  assert.deepEqual(settleTactic([other, played], played, true), [other, played]);
  const full = tacticBooster(rng, TACTIC_HAND_MAX);
  assert.equal(settleTactic(full, played, true).length, TACTIC_HAND_MAX);
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

test('each side picks one map in a Bo3 and two from a Bo5, leaving a decider', () => {
  assert.equal(mapPicksPerSide(1), 1);
  assert.equal(mapPicksPerSide(3), 1);
  assert.equal(mapPicksPerSide(5), 2);
  for (const bestOf of [3, 5]) assert.equal(bestOf - mapPicksPerSide(bestOf) * 2, 1);
});
