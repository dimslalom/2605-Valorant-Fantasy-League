import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROUND_DELAY,
  describeRound,
  roundPacing,
  roundSignificance,
} from '../src/engine/roundEvents.js';

test('round descriptions derive score, streaks, match point, and map point', () => {
  const rounds = [...Array(12).fill('A'), 'B', 'A'];
  assert.deepEqual(describeRound(rounds, 11), {
    round: 12, winner: 'A', a: 12, b: 0,
    isMatchPoint: true, isMapPoint: false, isOvertime: false,
    streak: 12, isStreakBreak: false,
  });
  assert.equal(describeRound(rounds, 12).isStreakBreak, true);
  assert.equal(describeRound(rounds, 13).isMapPoint, true);
});

test('match point accounts for the 19-round hard cap, not just a 2-round lead', () => {
  // 18 rounds each, alternating, so neither side ever led by 2 before this
  // point (simMap's loop only breaks on a >=2 margin OR a hard cap at 19).
  // At 18-18, either team winning the next round hits 19 and ends the map
  // immediately even though the margin would only be 1.
  const rounds = Array.from({ length: 36 }, (_, i) => (i % 2 === 0 ? 'A' : 'B'));
  const desc = describeRound(rounds, 35);
  assert.equal(desc.a, 18);
  assert.equal(desc.b, 18);
  assert.equal(desc.isMatchPoint, true);
});

test('overtime and significance are derived without changing simulation', () => {
  const rounds = [...Array(12).fill('A'), ...Array(12).fill('B'), 'A'];
  const overtime = describeRound(rounds, 24);
  assert.equal(overtime.isOvertime, true);
  assert.equal(roundSignificance(overtime), 'significant');
  assert.equal(roundSignificance(describeRound(['A'], 0)), 'normal');
});

test('round pacing defaults to 150ms and exposes a slowdown seam', () => {
  const desc = describeRound(['A'], 0);
  assert.equal(roundPacing(desc), DEFAULT_ROUND_DELAY);
  assert.equal(roundPacing(desc, { defaultDelay: 90 }), 90);
  assert.equal(roundPacing(desc, { delayFor: (_round, base) => base * 2 }), 300);
});
