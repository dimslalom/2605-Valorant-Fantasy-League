import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { ctxFor, playMatchday, startReplay } from '../src/engine/fantasy/game.js';
import { squadOf, standings } from '../src/engine/fantasy/league.js';
import { buildReplay } from '../src/engine/fantasy/replay.js';
import { synthMatches } from './fixtures/fantasySynth.js';

const replay = () => buildReplay({ matches: synthMatches(1), cards });

test('a replay groups matches into ordered matchdays and prices every step', () => {
  const r = replay();
  assert.equal(r.matchdays.length, 3);
  assert.deepEqual(r.matchdays.map(m => m.id), ['md1', 'md2', 'md3']);
  assert.equal(r.valuesAt.length, 3);
  const pid = Object.keys(r.players)[0];
  assert.ok(r.valuesAt.every(t => t[pid].v >= 500));
  assert.ok(Object.values(r.players).every(p => ['duelist', 'initiator', 'controller', 'sentinel', 'flex'].includes(p.role)));
  assert.ok(Object.values(r.players).some(p => p.card), 'feed players join to cards by handle and tag');
});

test('no future leakage: prices at step n are identical when later matchdays are removed', () => {
  const full = buildReplay({ matches: synthMatches(1), cards });
  const cut = buildReplay({ matches: synthMatches(1).filter(m => m.roundId !== '1:2026-09-26'), cards });
  // Step 0 and 1 are priced from earlier days only. Outlook can differ once the
  // final day is gone (teams with no series ahead), so compare form-based bases.
  for (const step of [0, 1]) {
    for (const pid of Object.keys(cut.players)) {
      assert.equal(cut.valuesAt[step][pid].ep, full.valuesAt[step][pid].ep, `ep leak at step ${step}`);
    }
  }
});

test('a full replay: market closes, points land, cash pays out, invariants hold at every step', () => {
  const r = replay();
  let state = startReplay(r, { seed: 3 });
  assert.equal(state.step, 0);
  assert.equal(state.market.listings.length, Math.min(10, Math.floor(Object.keys(r.players).filter(p => state.owner[p] == null).length * 0.4)));
  let steps = 0;
  while (state.status !== 'done') {
    const cashBefore = state.cash.you;
    const out = playMatchday(state, r, null);
    state = out.state;
    steps += 1;
    const seen = new Set();
    for (const pid of Object.keys(state.owner)) { assert.ok(!seen.has(pid)); seen.add(pid); }
    for (const m of state.managers) assert.ok(state.cash[m.id] >= 0);
    assert.ok(out.results.you.total !== undefined);
    assert.ok(state.cash.you >= 0 && cashBefore >= 0);
  }
  assert.equal(steps, 3);
  const table = standings(state);
  assert.equal(table.length, 8);
  assert.ok(table[0].total > 0);
  assert.equal(Object.keys(state.lineups).length, 3);
});

test('the human lineup is used when legal and the captain doubles', () => {
  const r = replay();
  let state = startReplay(r, { seed: 4 });
  const squad = squadOf(state, 'you');
  const roleOf = pid => r.players[pid].role;
  const D = squad.find(p => roleOf(p) === 'duelist');
  const I = squad.find(p => roleOf(p) === 'initiator');
  const C = squad.find(p => roleOf(p) === 'controller');
  const rest = squad.filter(p => ![D, I, C].includes(p));
  if ([D, I, C].some(p => p == null) || rest.length < 2) return; // this seed's deal lacks a role: nothing to assert
  const draft = { slots: { D, I, C, F1: rest[0], F2: rest[1] }, bench: [], captain: D };
  const out = playMatchday(state, r, draft);
  assert.equal(out.locked.you.slots.D, D);
  assert.equal(out.locked.you.captain, D);
  state = out.state;
  assert.equal(state.step, 1);
});

test('replay play is deterministic from the seed', () => {
  const run = () => {
    const r = replay();
    let s = startReplay(r, { seed: 8 });
    while (s.status !== 'done') s = playMatchday(s, r, null).state;
    return standings(s).map(x => `${x.id}:${x.total}`).join();
  };
  assert.equal(run(), run());
});

test('ctxFor clamps to the last step', () => {
  const r = replay();
  assert.equal(ctxFor(r, 99).values, r.valuesAt[2]);
});

test('team strengths and playback steps: totals of the playback equal the settled score', async () => {
  const { teamStrengths, playbackSteps } = await import('../src/engine/fantasy/replay.js');
  const r = replay();
  const strengths = teamStrengths(r.players, r.valuesAt[0]);
  assert.ok(Object.values(strengths).every(v => v > 0));

  let state = startReplay(r, { seed: 3 });
  const out = playMatchday(state, r, null);
  const sl = out.locked.you;
  const starters = Object.values(out.results.you.subs.reduce((acc, s) => ({ ...acc, [s.slot]: s.in }), { ...sl.slots }));
  const steps = playbackSteps(out.md, starters, out.results.you.captain);
  const replayed = steps.reduce((sum, st) => sum + st.lines.reduce((a, l) => a + l.counted, 0), 0);
  assert.equal(replayed, out.results.you.total);
  assert.ok(steps.length > 0);
});

test('thin group-stage days merge into one matchday; bracket days never do', () => {
  const all = synthMatches(1);
  const byDay = day => all.filter(m => m.roundId === day).slice(0, 2);
  const grp = ms => ms.map(m => ({ ...m, stage: 'Group Stage' }));
  const merged = buildReplay({ matches: grp([...byDay('1:2026-09-24'), ...byDay('1:2026-09-25'), ...byDay('1:2026-09-26')]), cards });
  assert.equal(merged.matchdays.length, 1);
  assert.equal(merged.matchdays[0].days.length, 3);
  const bracket = buildReplay({ matches: [...byDay('1:2026-09-24'), ...byDay('1:2026-09-25')].map(m => ({ ...m, stage: 'Playoffs' })), cards });
  assert.equal(bracket.matchdays.length, 2);
});
