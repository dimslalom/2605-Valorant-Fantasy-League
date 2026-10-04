import { test } from 'node:test';
import assert from 'node:assert/strict';
import { untilOf } from '../apps/call/src/lib/time.js';

test('untilOf reads like a countdown and stops at kick-off', () => {
  assert.equal(untilOf(1000, 1000 + 1), null);
  assert.equal(untilOf(45 * 60, 0), 'in 45m');
  assert.equal(untilOf(3 * 3600 + 20 * 60, 0), 'in 3h 20m');
  assert.equal(untilOf(5 * 3600, 0), 'in 5h');
  assert.equal(untilOf(3 * 86400, 0), 'in 3d');
});
