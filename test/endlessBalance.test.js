// Does the endless ladder actually kill the two failure cases?
//
//   Case 1, the death spiral: lose, earn no packs, never improve, keep losing.
//   Case 2, the runaway:      win, improve, get an easier draw, win forever.
//
// These simulate whole runs against the real card data. Deliberately, the
// squad NEVER improves here - no packs, no development, no chemistry growth.
// That is the worst case for case 1, and it isolates the ladder as the only
// thing doing the work.

import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import {
  buildBracket, mulberry32, npcTeamPower, resolveTournamentToChampion, samplePack, teamPower,
} from '../src/engine/perfectRun.js';
import { buildEndlessBracket } from '../src/engine/endless/field.js';
import { STARTING_TIER, eventPoints, placementFor, yearEndMovement } from '../src/engine/endless/ladder.js';

const RUNS = 120;
const YEARS = 8;

/** A realistic draft: five packs, taking the best card that fills a role gap. */
function draft(rng) {
  const picks = [], ids = new Set();
  for (let i = 0; i < 5; i++) {
    const pack = samplePack(rng, cards, ids);
    const covered = new Set(picks.map(p => p.role));
    const card = pack.find(c => !covered.has(c.role)) ?? pack[0];
    picks.push(card); ids.add(card.id);
  }
  return { picks, ids };
}

/** Which round the player went out in, or null if they won it. */
function playerExit(tour) {
  for (const round of tour.rounds) {
    const match = round.matches.find(m => m.a === 'player' || m.b === 'player');
    if (match?.winner && match.winner !== 'player') return round.label;
  }
  return null;
}

function simulateRun(seed, { ladder }) {
  const rng = mulberry32(seed);
  const { picks, ids } = draft(rng);
  const iglId = npcTeamPower(picks).iglId;
  const power = teamPower(picks, iglId).power;

  let tier = STARTING_TIER;
  const events = [];
  for (let year = 0; year < YEARS; year++) {
    let points = 0;
    for (let e = 0; e < 3; e++) {
      const playerTeam = { id: 'player', tag: 'YOU', name: 'YOU', roster: picks, iglId, power, isPlayer: true };
      const kind = e === 2 ? 'champions' : 'masters';
      const tour = ladder
        ? buildEndlessBracket(rng, cards, ids, playerTeam, tier, { kind })
        : buildBracket(rng, cards, ids, playerTeam, kind);
      resolveTournamentToChampion(tour, rng);

      const exit = playerExit(tour);
      const champion = exit === null;
      points += eventPoints(placementFor(exit ?? 'Grand Final', champion));
      events.push({ tier, champion });
    }
    if (ladder) tier = yearEndMovement(tier, points).tier;
  }
  return { events, power, titles: events.filter(e => e.champion).length };
}

const ladderRuns = Array.from({ length: RUNS }, (_, i) => simulateRun(4000 + i, { ladder: true }));

test('case 1 is dead: almost every run wins something', () => {
  const barren = ladderRuns.filter(run => run.titles === 0).length;
  assert.ok(barren / RUNS < 0.08,
    `${barren}/${RUNS} runs never won a title in ${YEARS} years`);

  const median = [...ladderRuns].sort((a, b) => a.titles - b.titles)[Math.floor(RUNS / 2)].titles;
  assert.ok(median >= 2, `median run won only ${median} titles`);
});

test('the flat pool it replaces was the spiral', () => {
  // The old field draws Masters from the top 30 orgs and Champions from the
  // top 15 outright, so a normal draft is priced out of winning at all. This
  // is the baseline the ladder has to beat, asserted so nobody restores it.
  const flat = Array.from({ length: 40 }, (_, i) => simulateRun(4000 + i, { ladder: false }));
  const barren = flat.filter(run => run.titles === 0).length / flat.length;
  const laddered = ladderRuns.filter(run => run.titles === 0).length / RUNS;
  assert.ok(barren > 0.8, `flat pool should starve most runs, got ${(barren * 100).toFixed(0)}%`);
  assert.ok(laddered < barren / 4, 'the ladder must be a large improvement, not a nudge');
});

test('case 2 is dead: nobody runs away with it', () => {
  const dominant = ladderRuns.filter(run => run.titles / run.events.length > 0.7).length;
  assert.equal(dominant, 0, `${dominant} runs won more than 70% of their events`);

  const overall = ladderRuns.reduce((s, r) => s + r.titles, 0)
    / ladderRuns.reduce((s, r) => s + r.events.length, 0);
  assert.ok(overall > 0.05 && overall < 0.30,
    `overall title rate ${(overall * 100).toFixed(1)}% is outside the intended band`);
});

test('the ladder finds each squad its own level', () => {
  // Settled tier over the back half of the run, by how good the draft was.
  const settled = run => {
    const tail = run.events.slice(-9);
    return tail.reduce((s, e) => s + e.tier, 0) / tail.length;
  };
  const weak = ladderRuns.filter(r => r.power < 80);
  const strong = ladderRuns.filter(r => r.power >= 88);
  assert.ok(weak.length >= 5 && strong.length >= 5, 'need both bands represented');

  const avg = list => list.reduce((s, r) => s + settled(r), 0) / list.length;
  assert.ok(avg(strong) > avg(weak) + 0.5,
    `stronger drafts must settle higher (weak ${avg(weak).toFixed(2)} vs strong ${avg(strong).toFixed(2)})`);

  // ...and a weak squad must still win at the level it lands in - that is the
  // difference between "found my level" and "still spiralling".
  const weakTitles = weak.reduce((s, r) => s + r.titles, 0) / weak.length;
  assert.ok(weakTitles >= 1, `weak drafts averaged only ${weakTitles.toFixed(2)} titles`);
});

test('roster quality still decides how far you climb', () => {
  // The counter-check on the two tests above: the ladder must not flatten the
  // game into a coin toss, or packs, chemistry and development stop mattering.
  const weak = ladderRuns.filter(r => r.power < 80);
  const strong = ladderRuns.filter(r => r.power >= 88);
  const avg = list => list.reduce((s, r) => s + r.titles, 0) / list.length;
  assert.ok(avg(strong) > avg(weak) * 1.5,
    `a better squad must win meaningfully more (${avg(weak).toFixed(2)} vs ${avg(strong).toFixed(2)})`);
});

test('simulated runs are reproducible for a given seed', () => {
  assert.deepEqual(simulateRun(4242, { ladder: true }), simulateRun(4242, { ladder: true }));
});
