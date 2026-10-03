import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { buildReplay } from '../src/engine/fantasy/replay.js';
import { scoreSeries } from '../src/engine/fantasy/scoring.js';
import { resolveCall, seriesFacts, streakMultiplier } from '../src/engine/collect/calls.js';
import { buyPack, callRecord, createCollection, resolveMatchday, resolveSeries, setCall, swapFee, swapTracked, totalScore, trackedAt } from '../src/engine/collect/game.js';
import { openPack, starterCollection } from '../src/engine/collect/packs.js';
import { CALL, ECONOMY, TRACKED_MAX } from '../src/engine/collect/rules.js';
import { synthMatches } from './fixtures/fantasySynth.js';

const replay = () => buildReplay({ matches: synthMatches(1), cards });
const poolOf = r => Object.values(r.players).filter(p => p.card).map(p => ({ pid: p.pid, tier: p.card.palette }));
const teamOfFn = r => pid => r.players[pid].team;

test('streak multiplier grows 10% per right call and caps at 1.5', () => {
  assert.equal(streakMultiplier(0), 1);
  assert.equal(streakMultiplier(3), 1.3);
  assert.equal(streakMultiplier(50), CALL.streakCap);
});

test('a call is scored line by line and is never negative', () => {
  const r = replay();
  const series = r.matchdays[0].matches[0]; // synth: team 0 wins 2-0
  const points = scoreSeries(series);
  const facts = seriesFacts(series, points);
  assert.equal(facts.winnerTag, series.teams[0].tag);
  const star = facts.star[0];

  const perfect = resolveCall({ winner: facts.winnerTag, score: facts.score, star }, series, points, { tracked: [], teamOf: teamOfFn(r), streak: 0 });
  assert.equal(perfect.total, CALL.winner + CALL.exactScore + CALL.star);

  const wrong = resolveCall({ winner: series.teams[1].tag }, series, points, { tracked: [], teamOf: teamOfFn(r), streak: 5 });
  assert.equal(wrong.total, 0);
  assert.equal(wrong.multiplier, 1);

  const starOnly = resolveCall({ winner: series.teams[1].tag, star }, series, points, { tracked: [], teamOf: teamOfFn(r) });
  assert.equal(starOnly.total, CALL.star); // the star read pays even when the winner was wrong
});

test('backing: Tracked players on the team you called add a capped bonus when you are right', () => {
  const r = replay();
  const series = r.matchdays[0].matches[0];
  const points = scoreSeries(series);
  const winner = series.teams[0].tag;
  const mine = Object.values(r.players).filter(p => p.team === winner).map(p => p.pid);
  const call = { winner };
  const none = resolveCall(call, series, points, { tracked: [], teamOf: teamOfFn(r) });
  const some = resolveCall(call, series, points, { tracked: mine.slice(0, 3), teamOf: teamOfFn(r) });
  assert.equal(some.lines.backing, 3 * CALL.backing);
  assert.equal(some.total - none.total, 3 * CALL.backing);
  const capped = resolveCall(call, series, points, { tracked: mine, teamOf: teamOfFn(r) });
  assert.ok(capped.lines.backing <= CALL.backingCap);
});

test('against the grain: hedging pays a little only when you are right', () => {
  const r = replay();
  const series = r.matchdays[0].matches[0];
  const points = scoreSeries(series);
  const loser = series.teams[1].tag;
  const hedge = Object.values(r.players).find(p => p.team === loser).pid;
  const res = resolveCall({ winner: series.teams[0].tag }, series, points, { tracked: [hedge], teamOf: teamOfFn(r) });
  assert.equal(res.lines.againstGrain, CALL.againstGrain);
});

test('starter collection: ten distinct cards with the intended tier mix, deterministic', () => {
  const pool = poolOf(replay());
  const a = starterCollection(7, pool);
  assert.equal(new Set(a).size, ECONOMY.starterCards);
  assert.deepEqual(a, starterCollection(7, pool));
  assert.notDeepEqual(a, starterCollection(8, pool));
});

test('packs never repeat a card you own and refund when the pool runs dry', () => {
  const pool = poolOf(replay());
  const owned = starterCollection(3, pool);
  const { cards: got } = openPack(3, 0, pool, owned);
  assert.equal(got.length, ECONOMY.packSize);
  assert.ok(got.every(pid => !owned.includes(pid)));
  const all = pool.map(e => e.pid);
  const dry = openPack(3, 1, pool, all);
  assert.equal(dry.cards.length, 0);
  assert.equal(dry.refund, ECONOMY.packSize * ECONOMY.duplicateRefund);
});

test('Tracked: at most ten, swaps need a card you own, the first swaps are free, then they cost credits', () => {
  const r = replay();
  const pool = poolOf(r);
  let s = createCollection({ seed: 5, pool, now: 0 });
  assert.equal(s.tracked.length, TRACKED_MAX);
  const tierOf = pid => r.players[pid].card.palette;
  const outsider = pool.find(e => !s.collection.includes(e.pid)).pid;
  assert.throws(() => swapTracked(s, s.tracked[0], outsider, tierOf), /do not own/);

  // give ourselves more cards, then swap past the free ones
  s = { ...s, collection: [...s.collection, ...pool.slice(0, 40).map(e => e.pid).filter(p => !s.collection.includes(p))] };
  const spare = () => s.collection.find(p => !s.tracked.includes(p));
  for (let i = 0; i < 3; i++) s = swapTracked(s, s.tracked[0], spare(), tierOf);
  assert.equal(s.freeSwaps, 0);
  assert.throws(() => swapTracked(s, s.tracked[0], spare(), tierOf), /not enough credits/);
  s = { ...s, credits: 1000 };
  const incoming = spare();
  const fee = swapFee(tierOf(incoming));
  const after = swapTracked(s, s.tracked[0], incoming, tierOf);
  assert.equal(after.credits, 1000 - fee);
  assert.equal(new Set(after.tracked).size, TRACKED_MAX);
});

test('buying a pack costs credits and adds five new cards', () => {
  const pool = poolOf(replay());
  let s = createCollection({ seed: 2, pool, now: 0 });
  assert.throws(() => buyPack(s, pool), /not enough credits/);
  s = { ...s, credits: 800 };
  const { state, cards: got } = buyPack(s, pool);
  assert.equal(state.credits, 800 - ECONOMY.packCost);
  assert.equal(state.collection.length, s.collection.length + got.length);
  assert.equal(new Set(state.collection).size, state.collection.length);
});

test('a full replay: calls and Tracked points both land, credits track points, skipped calls do not break a streak', () => {
  const r = replay();
  const pool = poolOf(r);
  let s = createCollection({ seed: 9, pool, now: 0 });
  const teamOf = teamOfFn(r);
  let totalCredits = 0;
  for (const md of r.matchdays) {
    // call the first team in each series; skip every third series
    md.matches.forEach((series, i) => { if (i % 3 !== 2) s = setCall(s, series.matchId, { winner: series.teams[0].tag }); });
    const out = resolveMatchday(s, md, { teamOf });
    s = out.state;
    totalCredits += out.report.total;
    assert.equal(out.report.total, out.report.callPoints + out.report.trackedPoints);
    assert.ok(out.report.callPoints >= 0);
    assert.ok(out.report.callsRight <= out.report.callsMade);
  }
  // synthetic series are won by the first team, so every call made was right
  assert.ok(s.streak > 5);
  assert.equal(s.credits, totalCredits);
  assert.equal(totalScore(s), totalCredits);
  assert.equal(s.history.length, r.matchdays.length);
});

test('Tracked scoring only counts the ten you track', () => {
  const r = replay();
  const pool = poolOf(r);
  const s = createCollection({ seed: 4, pool, now: 0 });
  const md = r.matchdays[0];
  const out = resolveMatchday(s, md, { teamOf: teamOfFn(r) });
  for (const line of out.report.trackedLines) assert.ok(s.tracked.includes(line.pid));
  const noneTracked = resolveMatchday({ ...s, tracked: [] }, md, { teamOf: teamOfFn(r) });
  assert.equal(noneTracked.report.trackedPoints, 0);
});

test('resolveSeries scores one match once: reveal is idempotent and pays credits', () => {
  const r = replay();
  const pool = poolOf(r);
  let s = createCollection({ seed: 6, pool, now: 0 });
  const series = r.matchdays[0].matches[0];
  s = setCall(s, series.matchId, { winner: series.teams[0].tag });
  const first = resolveSeries(s, series, { teamOf: teamOfFn(r) });
  assert.equal(first.report.callPoints >= CALL.winner, true);
  assert.equal(first.state.credits, first.report.total);
  const again = resolveSeries(first.state, series, { teamOf: teamOfFn(r) });
  assert.equal(again.state.credits, first.state.credits);   // no double pay
  assert.equal(again.state.history.length, 1);
  assert.deepEqual(callRecord(first.state), { made: 1, right: 1 });
});

test('a match scores the cards you were Tracking when it started, not the ones you swap to afterwards', () => {
  const r = replay();
  const pool = poolOf(r);
  const tierOf = pid => r.players[pid].card.palette;
  let s = createCollection({ seed: 3, pool, now: 0 });
  const series = r.matchdays[0].matches[0];
  const start = 1000;
  const startedSeries = { ...series, startsAt: start };
  // Track nobody who plays in this series at kick-off, then swap a participant in AFTER it started.
  const inSeries = new Set(series.maps.flatMap(m => m.players.map(p => p.vlrId)));
  const participant = [...inSeries][0];
  s = { ...s, collection: [...new Set([...s.collection, participant])] };
  s = { ...s, tracked: s.tracked.filter(p => !inSeries.has(p)), trackedLog: [{ t: 0, tracked: s.tracked.filter(p => !inSeries.has(p)) }] };
  assert.ok(s.tracked.length > 0);
  s = swapTracked(s, s.tracked[0], participant, tierOf, start + 500);   // swapped in after kick-off
  assert.ok(!trackedAt(s, start).includes(participant));
  assert.ok(trackedAt(s, start + 600).includes(participant));
  const out = resolveSeries(s, startedSeries, { teamOf: teamOfFn(r) });
  assert.ok(out.report.trackedLines.every(l => l.pid !== participant), 'the late swap must not score');
});

test('matches that started before you joined can be revealed but never score', () => {
  const r = replay();
  const pool = poolOf(r);
  const series = { ...r.matchdays[0].matches[0], startsAt: 5000 };
  const early = createCollection({ seed: 1, pool, now: 9000 });
  const out = resolveSeries(early, series, { teamOf: teamOfFn(r) });
  assert.equal(out.report.total, 0);
  assert.equal(out.report.preJoin, true);
  assert.equal(out.state.credits, 0);
  assert.equal(out.state.streak, 0);
  const joinedBefore = createCollection({ seed: 1, pool, now: 1000 });
  assert.ok(resolveSeries(joinedBefore, series, { teamOf: teamOfFn(r) }).report.preJoin !== true);
});
