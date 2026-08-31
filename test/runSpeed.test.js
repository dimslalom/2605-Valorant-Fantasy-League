import test from 'node:test';
import assert from 'node:assert/strict';
import { speedMultiplier, scaleDuration, RUN_SPEEDS } from '../src/lib/useRunSpeed.js';

test('RUN_SPEEDS lists the three supported preferences', () => {
  assert.deepEqual(RUN_SPEEDS, ['normal', 'fast', 'instant']);
});

test('speedMultiplier: normal is 1x, instant is 0x, fast falls in between', () => {
  assert.equal(speedMultiplier('normal'), 1);
  assert.equal(speedMultiplier('instant'), 0);
  assert.ok(speedMultiplier('fast') > 0 && speedMultiplier('fast') < 1);
});

test('speedMultiplier: an unknown value falls back to normal (1x)', () => {
  assert.equal(speedMultiplier('warp-speed'), 1);
  assert.equal(speedMultiplier(undefined), 1);
});

test('scaleDuration applies the multiplier and rounds to a whole ms', () => {
  assert.equal(scaleDuration(2200, 'normal'), 2200);
  assert.equal(scaleDuration(2200, 'instant'), 0);
  assert.equal(scaleDuration(2000, 'fast'), 900); // 2000 * 0.45
  assert.equal(Number.isInteger(scaleDuration(1701, 'fast')), true);
});
