import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { eligibleOrgs, mulberry32, npcTeamPower, teamPower } from '../src/engine/perfectRun.js';
import {
  MAX_REPUTATION, PROMOTE_AT, RELEGATE_AT, STARTING_TIER, TIERS, TIER_META,
  eventPoints, placementFor, reputationDelta, reputationRank, tierPools, yearEndMovement,
} from '../src/engine/endless/ladder.js';
import {
  FIELD_COMPRESSION, applyEndlessForm, buildEndlessBracket, endlessFieldPool,
  endlessPlayerPower, fieldSizeFor,
} from '../src/engine/endless/field.js';

const playerTeam = (roster) => ({
  id: 'player', tag: 'YOU', name: 'YOU', roster,
  iglId: npcTeamPower(roster).iglId,
  power: teamPower(roster, npcTeamPower(roster).iglId).power,
  isPlayer: true,
});

// ── tiers ───────────────────────────────────────────────────────────────────

test('the three tiers partition the org pool with no gaps or overlaps', () => {
  const pool = eligibleOrgs(cards, new Set());
  const pools = tierPools(pool, cards);

  assert.equal(pools.length, TIERS.length);
  assert.equal(pools.reduce((sum, p) => sum + p.length, 0), pool.length);

  const seen = new Set();
  for (const tierPool of pools) {
    for (const org of tierPool) {
      assert.equal(seen.has(org.id), false, `${org.id} is in two tiers`);
      seen.add(org.id);
    }
  }
});

test('each tier is meaningfully stronger than the one below it', () => {
  const pools = tierPools(eligibleOrgs(cards, new Set()), cards);
  const avg = list => list.reduce((sum, o) => sum + o.power, 0) / list.length;
  const [chl, asc, int] = pools.map(avg);

  assert.ok(asc > chl + 4, `Ascension (${asc.toFixed(1)}) must clear Challengers (${chl.toFixed(1)})`);
  assert.ok(int > asc + 4, `International (${int.toFixed(1)}) must clear Ascension (${asc.toFixed(1)})`);
});

test('every tier can field a full bracket', () => {
  for (let tier = 0; tier < TIERS.length; tier++) {
    assert.ok(endlessFieldPool(cards, new Set(), tier).length >= fieldSizeFor(tier) - 1,
      `${TIER_META[tier].label} cannot fill a bracket`);
  }
});

// ── promotion and relegation ────────────────────────────────────────────────

test('a strong year promotes and a poor year relegates', () => {
  assert.equal(yearEndMovement(1, PROMOTE_AT).movement, 'promote');
  assert.equal(yearEndMovement(1, PROMOTE_AT).tier, 2);
  assert.equal(yearEndMovement(1, RELEGATE_AT).movement, 'relegate');
  assert.equal(yearEndMovement(1, RELEGATE_AT).tier, 0);
  assert.equal(yearEndMovement(1, 0).movement, 'hold');
});

test('the ladder has ends - you cannot fall off either edge', () => {
  assert.deepEqual(yearEndMovement(0, -99), { movement: 'hold', tier: 0 });
  assert.deepEqual(yearEndMovement(2, 99), { movement: 'hold', tier: 2 });
});

test('a title-winning year promotes, a year of first-round exits relegates', () => {
  const year = placements => placements.reduce((sum, p) => sum + eventPoints(p), 0);
  assert.equal(yearEndMovement(1, year([1, 3, 3])).movement, 'promote');   // title + 2 semis
  assert.equal(yearEndMovement(1, year([9, 9, 9])).movement, 'relegate');  // three r16 exits
  assert.equal(yearEndMovement(1, year([5, 3, 5])).movement, 'hold');      // a middling year
});

test('placement reads off the round you went out in', () => {
  assert.equal(placementFor('Grand Final', true), 1);
  assert.equal(placementFor('Grand Final', false), 2);
  assert.equal(placementFor('Semifinals', false), 3);
  assert.equal(placementFor('Round of 16', false), 9);
});

// ── reputation ──────────────────────────────────────────────────────────────

test('the same finish is worth more the higher the tier', () => {
  assert.ok(reputationDelta(2, 1) > reputationDelta(1, 1));
  assert.ok(reputationDelta(1, 1) > reputationDelta(0, 1));
  // Farming the bottom tier must not out-earn competing at the top: reaching
  // an International final outweighs winning Challengers outright. (A title
  // still beats a semifinal - a trophy is a trophy.)
  assert.ok(reputationDelta(2, 2) > reputationDelta(0, 1));
  assert.ok(reputationDelta(2, 1) > 2 * reputationDelta(0, 1));
});

test('reputation ranks climb monotonically and stay in range', () => {
  let last = -1;
  for (let rep = 0; rep <= MAX_REPUTATION; rep += 25) {
    const rank = reputationRank(rep);
    assert.ok(rank.min >= last, 'ranks must not go backwards');
    last = rank.min;
  }
  assert.equal(reputationRank(0).key, 'unknown');
  assert.equal(reputationRank(MAX_REPUTATION).key, 'dynasty');
});

// ── form and compression ────────────────────────────────────────────────────

test('form is applied to every entrant, player included', () => {
  const roster = cards.filter(c => !c.org).slice(0, 5);
  const tour = buildEndlessBracket(mulberry32(7), cards, new Set(roster.map(c => c.id)),
    playerTeam(roster), 1);

  const teams = Object.values(tour.teams);
  assert.equal(teams.length, fieldSizeFor(1));
  for (const team of teams) {
    assert.ok(Number.isFinite(team.form), `${team.id} has no form roll`);
    assert.ok(Number.isFinite(team.simulationPower));
    assert.ok(Math.abs(team.form) <= 8, 'form is clamped to +/-8');
    assert.ok(['Hot', 'Steady', 'Cold'].includes(team.formLabel));
  }
});

test('compression tightens matchups without erasing the gap between tiers', () => {
  const roster = cards.filter(c => !c.org).slice(0, 5);
  const picked = new Set(roster.map(c => c.id));
  const fieldOf = tier => {
    const tour = buildEndlessBracket(mulberry32(11), cards, picked, playerTeam(roster), tier);
    const teams = Object.values(tour.teams);
    const range = pick => {
      const values = teams.map(pick);
      return Math.max(...values) - Math.min(...values);
    };
    return {
      rawSpread: range(t => t.power),
      formSpread: range(t => t.form),
      avg: tour.fieldAverage,
      compression: tour.compression,
    };
  };
  const chl = fieldOf(0), int = fieldOf(2);

  // The gap BETWEEN tiers survives, so the ladder stays the difficulty curve.
  assert.ok(int.avg > chl.avg + 8,
    `tier gap must survive compression (${chl.avg.toFixed(1)} vs ${int.avg.toFixed(1)})`);

  // WITHIN a tier, roster quality is deliberately not decisive. Challengers is
  // a homogeneous field (single-digit raw spread), so once power is scaled by
  // the compression factor, the form roll is the larger term - which is what
  // makes an upset there an ordinary event rather than a freak one.
  assert.ok(chl.formSpread > chl.rawSpread * chl.compression,
    'in a tight field, form must outweigh the compressed power gap');
  // The elite field is genuinely more spread out, so quality counts for more.
  assert.ok(int.rawSpread > chl.rawSpread);
});

test('compression is applied from the field average, to everyone alike', () => {
  const entrants = [
    { id: 'a', power: 70 }, { id: 'b', power: 80 }, { id: 'c', power: 90 },
  ];
  const fieldAverage = applyEndlessForm(mulberry32(3), entrants, 0.5);
  assert.equal(fieldAverage, 80);
  for (const team of entrants) {
    // simulationPower = avg + (power - avg) * k + form
    assert.ok(Math.abs(team.simulationPower - (80 + (team.power - 80) * 0.5 + team.form)) < 1e-9);
  }
});

test("the player's live power still moves the sim, so an IGL swap lands", () => {
  const tour = { fieldAverage: 80, compression: 0.5, teams: { player: { form: 2 } } };
  const weaker = endlessPlayerPower(tour, 84);
  const stronger = endlessPlayerPower(tour, 90);
  assert.ok(stronger > weaker, 'a better lineup must sim stronger mid-tournament');
  assert.equal(weaker, 80 + 4 * 0.5 + 2);
});

test('a bracket with no form data falls back to raw power', () => {
  assert.equal(endlessPlayerPower(null, 88), 88);
  assert.equal(endlessPlayerPower({ teams: {} }, 88), 88);
});

test('the endless bracket is deterministic and tier-scoped', () => {
  const roster = cards.filter(c => !c.org).slice(0, 5);
  const picked = new Set(roster.map(c => c.id));
  const a = buildEndlessBracket(mulberry32(2026), cards, picked, playerTeam(roster), 0);
  const b = buildEndlessBracket(mulberry32(2026), cards, picked, playerTeam(roster), 0);
  assert.deepEqual(b, a);
  assert.equal(a.tier, 0);
  assert.equal(a.compression, FIELD_COMPRESSION);

  // Every NPC entrant is drawn from that tier's pool, never the whole game.
  const tierIds = new Set(endlessFieldPool(cards, picked, 0).map(o => o.id));
  for (const team of Object.values(a.teams)) {
    if (team.isPlayer) continue;
    assert.ok(tierIds.has(team.id), `${team.id} is not in the Challengers pool`);
  }
});

test('the starting tier is the one a fresh draft can actually compete in', () => {
  assert.equal(STARTING_TIER, 1);
  const pools = tierPools(eligibleOrgs(cards, new Set()), cards);
  const avg = pools[STARTING_TIER].reduce((s, o) => s + o.power, 0) / pools[STARTING_TIER].length;
  // Measured draft strength is ~82-85 power; the opening field must sit in
  // that band rather than above it, or the run starts already lost.
  assert.ok(avg > 80 && avg < 88, `starting field averages ${avg.toFixed(1)}`);
});
