import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { mulberry32, teamChemistry, teamPower } from '../src/engine/perfectRun.js';
import {
  DRIFT_MAX, DRIFT_MIN, SOFT_MAX, SOFT_MIN, SOFT_WEIGHT,
  applyRoleChange, careerAge, careerStage, derivedProMonths, effectiveCard, effectiveRoster,
  emptyDev, fatiguePenalty, isLegendEligible, roleChangeOffer, softResidual, tickCareerYear,
  tickFatigue,
} from '../src/engine/endless/career.js';
import {
  BOND_MAX_STRENGTH, TOTAL_BOND_CHEM_CAP, bondChemistry, bondKey, decayIdleBonds,
  pairChem, pruneBonds, tickBondsAfterEvent,
} from '../src/engine/endless/bonds.js';

const SEED = 1234;
const veteran = (rating = 84) => ({
  id: 'vet', player: 'Vet', org: 'AAA', tier: 'gold', league: 'vct', rating,
  role: 'Duelist', nationality: 'US', agents: ['jett'],
  stats: { aim: 84, positioning: 84, ability: 84, mentality: 84, synergy: 84 },
  stints: [{ org: 'AAA', from: 24319 - 72, to: null }],   // 6 years pro
});

/** Age a player for `years`, returning total rating drift. */
function ageBy(years, ctx, card = veteran()) {
  const rng = mulberry32(99);
  let dev = emptyDev(card);
  for (let y = 0; y < years; y++) {
    dev = tickCareerYear(rng, SEED, card, dev, { ...ctx, year: y }).dev;
  }
  return dev;
}

// ── the balance guarantee ───────────────────────────────────────────────────

test('adding the soft-stat term changes nothing on day one', () => {
  // The soft stats correlate with rating at 0.995, so only their residual
  // carries information - and across the untouched pool that residual is
  // zero by construction. If this drifts, existing balance has moved.
  assert.ok(Math.abs(softResidual(cards)) < 0.1,
    `pool residual is ${softResidual(cards).toFixed(3)}, expected ~0`);

  const roster = cards.slice(0, 5);
  assert.ok(Math.abs(softResidual(roster) * SOFT_WEIGHT) < 4, 'a squad residual must stay small');
});

test('the engine is byte-identical when no endless options are passed', () => {
  // The regression pin for the opts-object gating: Daily, ENC and Multiplayer
  // all call these with two arguments and must be unaffected.
  for (let i = 0; i < 40; i++) {
    const roster = cards.slice(i * 5, i * 5 + 5);
    if (roster.length < 5) break;
    const iglId = roster[0].id;
    assert.deepEqual(teamChemistry(roster, iglId, {}), teamChemistry(roster, iglId));
    const withOpts = teamPower(roster, iglId, {});
    const without = teamPower(roster, iglId);
    assert.equal(withOpts.power, without.power);
    assert.equal(without.soft, 0);
  }
});

// ── the career arc ──────────────────────────────────────────────────────────

test('career age is derived from real stint data', () => {
  const dated = cards.filter(c => (c.stints ?? []).some(s => typeof s.from === 'number'));
  assert.ok(dated.length > 700, 'most cards should carry a dated stint');

  const ages = cards.map(c => careerAge(SEED, c, null));
  assert.ok(Math.min(...ages) >= 17 && Math.max(...ages) <= 35, 'ages must be plausible');

  // Icons are retired legends and must read as the oldest cohort.
  const iconAvg = avg(cards.filter(c => c.league === 'icon').map(c => careerAge(SEED, c, null)));
  const poolAvg = avg(ages);
  assert.ok(iconAvg > poolAvg + 3, `icons (${iconAvg.toFixed(1)}) should be older than the pool (${poolAvg.toFixed(1)})`);
});

test('age derivation is stable across a reload', () => {
  // debutAge is never stored - it is re-derived from (seed, id), so a resumed
  // run must not silently re-roll everyone's age.
  for (const card of cards.slice(0, 50)) {
    assert.equal(careerAge(SEED, card, null), careerAge(SEED, card, null));
    assert.equal(derivedProMonths(card), derivedProMonths(card));
  }
});

test('a well-managed squad player ages gracefully; a neglected one collapses', () => {
  // A player entering the run in their prime - the common case for a squad
  // you actually keep. The constraint being pinned is the design one: you
  // must not be FORCED to replace a favourite.
  const prime = { ...veteran(), stints: [{ org: 'AAA', from: 24319 - 12, to: null }] };
  const neglected = ageBy(8, { yearsAtOrg: 0, rested: 0, cohesion: 0 }, prime);
  const kept = ageBy(8, { yearsAtOrg: 5, rested: 1, cohesion: 4 }, prime);

  // Management must at least halve the decline...
  assert.ok(kept.d >= neglected.d / 2,
    `management must halve the fade (neglected ${neglected.d} vs kept ${kept.d})`);
  // ...and leave the player recognisably themselves: an 84 must still be a
  // useful card after eight years, not a passenger you are forced to cut.
  assert.ok(kept.d >= -8, `a well-managed player must stay viable, got ${kept.d}`);
  assert.ok(neglected.d <= -6, `a neglected player should fade, got ${neglected.d}`);
});

test('an old veteran fades even when kept, but legend status preserves them', () => {
  // The honest limit: continuity and rest buy YEARS, not immortality. Legend
  // is the mechanic that actually keeps a favourite, and it must be earned.
  const kept = ageBy(8, { yearsAtOrg: 5, rested: 1 });
  assert.ok(kept.d <= -6, 'a 27-year-old cannot be preserved by rotation alone');

  const rng = mulberry32(99);
  const card = veteran();
  let legend = { ...emptyDev(card), lg: 1 };
  for (let y = 0; y < 8; y++) legend = tickCareerYear(rng, SEED, card, legend, { year: y }).dev;
  assert.equal(legend.d, 0, 'a legend keeps their rating outright');
});

test('converting is worth taking rather than refusing', () => {
  // The conversion costs rating up front, so the decline relief has to
  // persist - a single year of it would make accepting strictly worse.
  const prime = { ...veteran(), stints: [{ org: 'AAA', from: 24319 - 12, to: null }] };
  const rng = mulberry32(99);
  let converted = applyRoleChange(emptyDev(prime), 'Controller');
  for (let y = 0; y < 8; y++) converted = tickCareerYear(rng, SEED, prime, converted, { yearsAtOrg: 5, rested: 1, year: y }).dev;
  const refused = ageBy(8, { yearsAtOrg: 5, rested: 1 }, prime);
  assert.ok(converted.d >= refused.d, `converting must pay off (converted ${converted.d} vs refused ${refused.d})`);
});

test('legend status stops decline outright', () => {
  const rng = mulberry32(5);
  const card = veteran();
  let dev = { ...emptyDev(card), lg: 1 };
  for (let y = 0; y < 10; y++) dev = tickCareerYear(rng, SEED, card, dev, { year: y }).dev;
  assert.equal(dev.d, 0, 'a legend must not drift at all');
  assert.equal(careerStage(SEED, card, dev), 'legend');
});

test('anti-decline can slow a veteran but never reverse one', () => {
  // Every mechanic is a multiplier on the decline term, so stacking all of
  // them must still trend downward. This is the guard against the four
  // bonuses compounding into an ageless squad.
  const maxed = ageBy(8, { yearsAtOrg: 99, rested: 99, cohesion: 99, roleChangedThisYear: true });
  assert.ok(maxed.d <= 0, `a veteran must never grow, got ${maxed.d}`);
});

test('a prospect grows, and growth respects the ceiling', () => {
  const rookie = {
    ...veteran(58), id: 'kid', tier: 'bronze', league: 't2',
    stints: [{ org: 'AAA', from: 24319 - 6, to: null }],
  };
  const grown = ageBy(5, { yearsAtOrg: 3, cohesion: 4 }, rookie);
  assert.ok(grown.d >= 4, `a prospect should develop, got ${grown.d}`);
  assert.ok(grown.d <= DRIFT_MAX);
});

test('drift stays inside its clamps under adversarial management', () => {
  for (const ctx of [
    { yearsAtOrg: 99, rested: 99, cohesion: 99 },
    { yearsAtOrg: 0, rested: 0, cohesion: 0 },
  ]) {
    const dev = ageBy(40, ctx);
    assert.ok(dev.d >= DRIFT_MIN && dev.d <= DRIFT_MAX, `drift ${dev.d} escaped its clamp`);
    for (const key of ['a', 'm', 's']) {
      assert.ok(dev[key] >= SOFT_MIN && dev[key] <= SOFT_MAX, `${key} escaped its clamp`);
    }
  }
});

test('development de-correlates the soft stats from rating', () => {
  // This is what makes the residual term meaningful by year three: the
  // veteran loses rating but gains mentality and synergy, so he is worth
  // more than his card number says.
  const dev = ageBy(4, { yearsAtOrg: 4, rested: 1 });
  assert.ok(dev.d < 0, 'rating should be falling');
  assert.ok(dev.m > 0, 'mentality should be rising');
  assert.ok(dev.s > 0, 'synergy should be rising with continuity');

  const card = veteran();
  const before = softResidual([card]);
  const after = softResidual([effectiveCard(card, dev)]);
  assert.ok(after > before, 'a kept veteran must out-earn his rating');
});

// ── role change ─────────────────────────────────────────────────────────────

test('only a veteran may convert, and only once', () => {
  const card = veteran();
  const old = { ...emptyDev(card), p: 84 };
  const offer = roleChangeOffer(SEED, card, old);
  assert.equal(offer.to, 'Controller');

  const converted = applyRoleChange(old, offer.to);
  assert.equal(converted.r, 'Controller');
  assert.equal(converted.d, -offer.ratingCost, 'conversion costs rating');
  assert.equal(roleChangeOffer(SEED, card, converted), null, 'no second conversion');

  const kid = { ...veteran(60), id: 'kid', stints: [{ org: 'AAA', from: 24319 - 6, to: null }] };
  assert.equal(roleChangeOffer(SEED, kid, emptyDev(kid)), null, 'prospects cannot convert');
});

test('converting to a strategic role pays back through existing chemistry', () => {
  // A Duelist IGL is worth +0 chem; a Controller IGL is worth +4. The role
  // change mechanic needs no new engine code - it re-enters teamChemistry.
  // Two Duelists, no Controller - converting one both fills the missing role
  // class and upgrades the caller, which is exactly when the offer is worth
  // taking. (Converting a squad's ONLY Duelist would break role coverage and
  // lose chemistry, which is a real decision rather than a free upgrade.)
  const squad = [
    veteran(), { ...veteran(80), id: 'b', role: 'Duelist' }, { ...veteran(80), id: 'c', role: 'Initiator' },
    { ...veteran(80), id: 'd', role: 'Sentinel' }, { ...veteran(80), id: 'e', role: 'Initiator' },
  ];
  const asDuelist = teamChemistry(squad, 'vet').total;
  const converted = squad.map(c => (c.id === 'vet' ? effectiveCard(c, { r: 'Controller' }) : c));
  const asController = teamChemistry(converted, 'vet').total;
  assert.ok(asController > asDuelist, 'a strategic caller must be worth more');
});

// ── fatigue and the load band ───────────────────────────────────────────────

test('both ends of the load band cost something', () => {
  let dev = emptyDev(veteran());
  for (let i = 0; i < 6; i++) dev = tickFatigue(dev, { started: true });
  assert.ok(fatiguePenalty(dev) > 0, 'playing every event must burn a player out');

  let rested = dev;
  for (let i = 0; i < 3; i++) rested = tickFatigue(rested, { started: false });
  assert.equal(fatiguePenalty(rested), 0, 'rest must fully restore');
  assert.ok(rested.idle >= 3, 'benched players accumulate idle events');
});

test('a five-man squad cannot rotate, so fatigue plateaus rather than spirals', () => {
  let dev = emptyDev(veteran());
  for (let i = 0; i < 30; i++) dev = tickFatigue(dev, { started: true });
  assert.ok(dev.f <= 100);
  assert.ok(fatiguePenalty(dev) <= 2, 'fatigue must stay a nudge, never a collapse');
});

test('effectiveCard is pure and leaves the source card untouched', () => {
  const card = veteran();
  const snapshot = JSON.parse(JSON.stringify(card));
  const out = effectiveCard(card, { d: -3, m: 5, r: 'Controller', f: 90 });
  assert.deepEqual(card, snapshot, 'the card must not be mutated');
  assert.equal(out.role, 'Controller');
  assert.ok(out.rating < card.rating);
  assert.equal(out.stats.mentality, card.stats.mentality + 5);
  assert.equal(effectiveCard(card, null), card, 'no dev means no copy');
});

test('effectiveRoster maps a whole squad', () => {
  const squad = cards.slice(0, 5);
  const dev = { [squad[0].id]: { d: 5 } };
  const out = effectiveRoster(squad, dev);
  assert.equal(out[0].rating, squad[0].rating + 5);
  assert.equal(out[1].rating, squad[1].rating);
});

test('legend eligibility needs titles, and is granted once', () => {
  assert.equal(isLegendEligible({}, 2), false);
  assert.equal(isLegendEligible({}, 3), true);
  assert.equal(isLegendEligible({ lg: 1 }, 9), false);
});

// ── bonds ───────────────────────────────────────────────────────────────────

test('a pair key is stable regardless of order', () => {
  assert.equal(bondKey('b', 'a'), bondKey('a', 'b'));
});

test('bonds build with shared events and saturate', () => {
  let bonds = {};
  for (let e = 0; e < 20; e++) bonds = tickBondsAfterEvent(bonds, ['a', 'b', 'c']).bonds;
  assert.equal(bonds[bondKey('a', 'b')], BOND_MAX_STRENGTH, 'bonds must saturate');
  assert.equal(pairChem(BOND_MAX_STRENGTH), 2);
});

test('a crossed threshold is announced so it can be surfaced', () => {
  let bonds = {};
  let announcements = 0;
  for (let e = 0; e < 6; e++) {
    const out = tickBondsAfterEvent(bonds, ['a', 'b']);
    bonds = out.bonds;
    announcements += out.formed.length;
  }
  assert.ok(announcements >= 2, 'each chemistry step should be announceable');
});

test('bonds decay when a pair stops playing together, and dead keys are dropped', () => {
  let bonds = {};
  for (let e = 0; e < 6; e++) bonds = tickBondsAfterEvent(bonds, ['a', 'b']).bonds;
  let out = { bonds };
  for (let e = 0; e < 10; e++) out = decayIdleBonds(out.bonds, ['a']);
  assert.equal(Object.keys(out.bonds).length, 0, 'a fully faded bond must not linger in the save');
});

test('a stable five earns a real but bounded chemistry edge', () => {
  const roster = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, player: id }));
  let bonds = {};
  for (let e = 0; e < 30; e++) bonds = tickBondsAfterEvent(bonds, roster.map(r => r.id)).bonds;

  const chem = bondChemistry(bonds, roster);
  assert.equal(chem.total, TOTAL_BOND_CHEM_CAP, 'a long-term core should reach the cap');
  assert.ok(chem.total * 0.6 < 8, 'and the cap must stay below a tier of rating');
  assert.ok(chem.lines.length > 0, 'the breakdown must be explainable to the player');
});

test('bond chemistry is zero for a squad that has never played together', () => {
  const roster = ['x', 'y', 'z'].map(id => ({ id, player: id }));
  assert.equal(bondChemistry({}, roster).total, 0);
});

test('pruning drops bonds for players who left the squad', () => {
  let bonds = {};
  for (let e = 0; e < 6; e++) bonds = tickBondsAfterEvent(bonds, ['a', 'b', 'c']).bonds;
  const pruned = pruneBonds(bonds, ['a', 'b']);
  assert.equal(Object.keys(pruned).length, 1);
  assert.ok(pruned[bondKey('a', 'b')]);
});

test('bonds fold into team chemistry through the engine options', () => {
  const roster = cards.slice(0, 5);
  let bonds = {};
  for (let e = 0; e < 30; e++) bonds = tickBondsAfterEvent(bonds, roster.map(r => r.id)).bonds;

  const plain = teamPower(roster, roster[0].id);
  const bonded = teamPower(roster, roster[0].id, { extra: bondChemistry(bonds, roster) });
  assert.ok(bonded.power > plain.power, 'a bonded core must sim stronger');
  assert.ok(Math.abs((bonded.power - plain.power) - TOTAL_BOND_CHEM_CAP * 0.6) < 1e-9);
});

function avg(list) { return list.reduce((a, b) => a + b, 0) / list.length; }
