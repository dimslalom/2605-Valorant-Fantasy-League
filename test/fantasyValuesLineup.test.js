import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTLOOK, VALUE } from '../src/engine/fantasy/constants.js';
import { applyAutoSubs, autoLineup, fantasyRole, validLineup } from '../src/engine/fantasy/lineup.js';
import { rngFor } from '../src/engine/shared/rng.js';
import { buildValueTable, expectedPoints, outlookOf, priorEP, stepValue, valueFromEP } from '../src/engine/fantasy/values.js';

test('value curve: EP 30 is 4.0M, convex, and bounded', () => {
  assert.equal(valueFromEP(30), 4000);
  assert.ok(valueFromEP(36) > 2 * valueFromEP(30) * 0.9 && valueFromEP(36) < 8200);
  assert.equal(valueFromEP(-50), VALUE.min);
  assert.equal(valueFromEP(200), VALUE.max);
});

test('expected points shrink toward the prior and weight recent maps', () => {
  assert.equal(expectedPoints([], 30), 30);
  const hot = expectedPoints([60, 60, 60], 30);
  assert.ok(hot > 30 && hot < 60);
  assert.ok(expectedPoints([60, 10], 30) > expectedPoints([10, 60], 30));
  assert.equal(priorEP({ rating: 82 }), 30);
  assert.equal(priorEP(null), 26);
});

test('form moves are capped per step but outlook changes are not', () => {
  const capped = stepValue(4000, { ep: 45, outlook: 'ACTIVE', cap: 0.06 });
  assert.equal(capped.base, 4240);
  const news = stepValue(4000, { ep: 30, outlook: 'OUT', cap: 0.06 });
  assert.equal(news.base, 4000);
  assert.equal(news.value, 4000 * OUTLOOK.OUT);  // -65% at once
  // Base tracks form only, so an expiring star (UNCERTAIN, 2600) who signs with a
  // partner team (WAITING) jumps 31% at once even though form is unchanged.
  const before = stepValue(4000, { ep: 30, outlook: 'UNCERTAIN', cap: 0.06 });
  const after = stepValue(before.base, { ep: 30, outlook: 'WAITING', cap: 0.06 });
  assert.equal(before.value, 2600);
  assert.equal(after.value, 3400);
});

test('outlook rules', () => {
  assert.equal(outlookOf('free_agent'), 'OUT');
  assert.equal(outlookOf('contract_year'), 'UNCERTAIN');
  assert.equal(outlookOf('active', { teamHasSeriesAhead: false, eliminatedWithLaterEvents: true }), 'WAITING');
  assert.equal(outlookOf('active', { teamHasSeriesAhead: false }), 'OUT');
  assert.equal(outlookOf('active'), 'ACTIVE');
});

test('buildValueTable stays inside bounds and respects the previous base', () => {
  const players = [
    { pid: 1, card: { rating: 90 }, mapPoints: [70, 65, 60] },
    { pid: 2, card: null, mapPoints: [], status: 'free_agent' },
  ];
  const t1 = buildValueTable({ players });
  const t2 = buildValueTable({ players: [{ ...players[0], mapPoints: [5, 5, 5] }, players[1]], prevTable: t1 });
  assert.ok(t2[1].base >= t1[1].base * 0.94 - 10);
  assert.ok(Object.values(t1).every(r => r.v >= VALUE.min && r.v <= VALUE.max));
});

const roles = { 1: 'duelist', 2: 'duelist', 3: 'duelist', 4: 'initiator', 5: 'controller', 6: 'sentinel', 7: 'controller' };

test('fantasy role comes from recent agents with a card fallback', () => {
  assert.equal(fantasyRole(['omen', 'omen', 'jett'], 'Duelist'), 'controller');
  assert.equal(fantasyRole([], 'Sentinel'), 'sentinel');
});

test('any five players can start, in any roles: three duelists and no controller is fine', () => {
  const squad = [1, 2, 3, 4, 5, 6, 7];
  assert.equal(roles[1], 'duelist');
  const draft = { slots: { S1: 1, S2: 2, S3: 3, S4: 4, S5: 6 }, captain: 1 };
  assert.equal(validLineup(draft, squad).ok, true);
});

test('validLineup still needs five distinct players you own and a starter as captain', () => {
  const squad = [1, 2, 3, 4, 5, 6, 7];
  assert.match(validLineup({ slots: { S1: 1, S2: 2, S3: 3, S4: 4 } }, squad).problems.join(), /S5 empty/);
  assert.match(validLineup({ slots: { S1: 1, S2: 1, S3: 3, S4: 4, S5: 5 } }, squad).problems.join(), /duplicate/);
  assert.match(validLineup({ slots: { S1: 1, S2: 2, S3: 3, S4: 4, S5: 99 } }, squad).problems.join(), /not owned/);
  assert.match(validLineup({ slots: { S1: 1, S2: 2, S3: 3, S4: 4, S5: 5 }, captain: 7 }, squad).problems.join(), /captain/);
});

test('autoLineup (AI only) picks the best five by expected points and captains the top scorer', () => {
  const squad = [1, 2, 3, 4, 5, 6, 7];
  const ep = { 1: 40, 2: 38, 3: 37, 4: 30, 5: 28, 6: 26, 7: 25 };
  const draft = autoLineup(squad, { epOf: p => ep[p] });
  assert.deepEqual(Object.values(draft.slots), [1, 2, 3, 4, 5]);
  assert.equal(draft.captain, 1);
  assert.deepEqual(draft.bench, [6, 7]);
  assert.equal(validLineup(draft, squad).ok, true);
});

test('autoLineup prefers players who actually play', () => {
  const squad = [1, 2, 3, 4, 5, 6, 7];
  const ep = { 1: 40, 2: 38, 3: 37, 4: 30, 5: 28, 6: 26, 7: 25 };
  const draft = autoLineup(squad, { epOf: p => ep[p], seriesOf: p => (p === 1 || p === 2 ? 0 : 1) });
  assert.ok(!Object.values(draft.slots).includes(1) && !Object.values(draft.slots).includes(2));
});

test('auto-sub: first bench player who played replaces a starter who did not', () => {
  const locked = { slots: { S1: 1, S2: 4, S3: 5, S4: 6, S5: 7 }, bench: [2, 3], captain: 4 };
  const played = { 1: 2, 4: 0, 5: 2, 6: 2, 7: 2, 2: 0, 3: 2 };
  const r = applyAutoSubs(locked, pid => played[pid]);
  assert.deepEqual(r.subs, [{ slot: 'S2', out: 4, in: 3 }]);
  assert.equal(r.starters.S2, 3);
  assert.equal(r.captain, null);  // the absent captain doubles nobody
});

test('per-decision RNG is reproducible and independent of call order', () => {
  const a = rngFor(7, 'd1', 'whale', 'bid')();
  rngFor(7, 'd1', 'other', 'bid')();
  assert.equal(rngFor(7, 'd1', 'whale', 'bid')(), a);
  assert.notEqual(rngFor(8, 'd1', 'whale', 'bid')(), a);
});
