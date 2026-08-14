import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import {
  BOOST_RATING_CAP,
  ENDLESS_LIVES,
  FATIGUE_PENALTY_CAP,
  MODIFIERS,
  SHOP_ITEMS,
  addEventFatigue,
  applyPurchase,
  applyRunEffects,
  buildEndlessBracket,
  effectiveTeamPower,
  endlessDifficulty,
  eventCredits,
  fatiguePenalty,
  mulberry32,
  nextEndlessCycle,
  npcTeamPower,
  teamPower,
  evaluateSeason,
} from '../src/engine/perfectRun.js';

const roster = cards.filter(card => card.org).slice(0, 5);

test('endless constants and difficulty curve stay on the intended ramp', () => {
  assert.equal(ENDLESS_LIVES, 3);
  assert.deepEqual([0, 1, 2, 3, 5].map(cycle => endlessDifficulty(cycle).formBoost), [0, 3, 6, 9, 12]);
  assert.deepEqual([0, 1, 2, 5].map(cycle => endlessDifficulty(cycle).superTeamCount), [0, 0, 1, 4]);
});

test('cycles pre-roll three cities and always reveal a Champions modifier', () => {
  const cycle = nextEndlessCycle(mulberry32(77), 2);
  assert.deepEqual(cycle.map(event => event.kind), ['masters', 'masters', 'champions']);
  assert.equal(new Set(cycle.map(event => event.city)).size, 3);
  assert.ok(cycle[2].modifier);
});

test('run effects are identity when empty and fatigue caps', () => {
  assert.equal(applyRunEffects(roster, { fatigue: {}, boosts: {} }), roster);
  assert.equal(fatiguePenalty(99), FATIGUE_PENALTY_CAP);
  const tired = addEventFatigue({ fatigue: {}, boosts: {} }, roster, 2);
  assert.equal(tired.fatigue[roster[0].id], 2);
});

test('boost purchases are pure, targeted, and rating-capped', () => {
  const initial = { fatigue: { [roster[0].id]: 2 }, boosts: {}, teamChemBonus: 0 };
  const boosted = Array.from({ length: 5 }).reduce(state => applyPurchase(state, 'aim_coach', roster[0].id), initial);
  assert.equal(initial.boosts[roster[0].id], undefined);
  const card = applyRunEffects([roster[0]], boosted)[0];
  assert.equal(card.rating, roster[0].rating + BOOST_RATING_CAP - 2);
  assert.equal(card.stats.aim, Math.min(99, roster[0].stats.aim + 10));
  assert.throws(() => applyPurchase(initial, 'aim_coach'), /Choose a player/);
});

test('every modifier has a concrete hook', () => {
  assert.equal(Object.keys(MODIFIERS).length, 8);
  const base = effectiveTeamPower(roster, roster[0].id, {});
  assert.equal(effectiveTeamPower(roster, roster[0].id, {}, 'hostile_crowd').power, base.power - 4);
  assert.ok(effectiveTeamPower(roster, roster[0].id, {}, 'duelist_slump').power <= base.power);
  assert.ok(effectiveTeamPower(roster, roster[0].id, {}, 'igl_silenced').power <= base.power);
  assert.notEqual(effectiveTeamPower(roster, roster[0].id, {}, 'cold_streak').power, base.power);
  assert.equal(MODIFIERS.bo1_r16.roundOverrides.r16.bestOf, 1);
  assert.equal(MODIFIERS.grueling_schedule.key, 'grueling_schedule');
  assert.equal(MODIFIERS.away_maps.bias, -2);
  assert.equal(MODIFIERS.giant_killers.key, 'giant_killers');
});

test('credits, purchases, and endless score reward cycle progress', () => {
  assert.equal(eventCredits({ mapsWon: 8, seriesWon: 4, champion: true, cycle: 0 }), 470);
  assert.equal(SHOP_ITEMS.length, 6);
  const results = Array.from({ length: 6 }, (_, index) => ({ cycle: Math.floor(index / 3), champion: index % 3 === 2, series: [{ won: true, mapsWon: 2, mapsLost: 0, roundDiff: 10 }] }));
  const summary = evaluateSeason(results, { endless: true });
  assert.equal(summary.bestCycle, 1);
  assert.ok(summary.score > 1000);
});

test('endless bracket uses chem-aware scaling and modifier overrides', () => {
  const playerRoster = cards.filter(card => !card.org).slice(0, 5);
  const player = { id: 'player', tag: 'YOU', name: 'Test', roster: playerRoster, power: teamPower(playerRoster, playerRoster[0].id).power, isPlayer: true };
  const bracket = buildEndlessBracket(mulberry32(2), cards, new Set(playerRoster.map(card => card.id)), player, 'champions', 3, MODIFIERS.bo1_r16);
  assert.equal(bracket.seeds.length, 16);
  assert.equal(bracket.rounds[0].bestOf, 1);
  const npcs = Object.values(bracket.teams).filter(team => !team.isPlayer);
  assert.ok(npcs.every(team => Number.isFinite(team.power)));
  assert.ok(npcTeamPower(npcs[0].roster).result.power <= npcs[0].power);
});
