import test from 'node:test';
import assert from 'node:assert/strict';
import { curlPoint, peekDrag } from '../apps/call/src/lib/cardCurl.js';

test('resting card stays flat and the unbent portion stays anchored', () => {
  for (let x = -0.5; x <= 0.5; x += 0.05) assert.deepEqual(curlPoint(x, 0), [x, 0]);
  assert.deepEqual(curlPoint(-0.4, 1), [-0.4, 0]);
});
test('the curl preserves sheet length and folds the front toward the viewer', () => {
  for (const p of [0.25, 0.6, 1]) {
    let length = 0;
    let last = curlPoint(-0.5, p);
    for (let i = 1; i <= 1000; i++) {
      const next = curlPoint(-0.5 + i / 1000, p);
      length += Math.hypot(next[0] - last[0], next[1] - last[1]);
      last = next;
    }
    assert.ok(Math.abs(length - 1) < 0.00001);
  }
  const nearEdge = curlPoint(0.49, 1);
  const edge = curlPoint(0.5, 1);
  assert.ok(edge[0] < nearEdge[0], 'edge folds back over the body');
  assert.ok(edge[1] > 0, 'edge lifts off the stack');
});
test('left and right peeks mirror each other without changing height', () => {
  for (const p of [0.25, 0.6, 1]) {
    const right = curlPoint(0.4, p, 1);
    const left = curlPoint(-0.4, p, -1);
    assert.equal(left[0], -right[0]);
    assert.equal(left[1], right[1]);
  }
});
test('gesture threshold scales with the card; vertical drags are not taps or reveals', () => {
  assert.equal(peekDrag(3, 2, 220).moved, false);
  assert.deepEqual(peekDrag(0, 80, 220), { moved: true, progress: 0, side: -1 });
  assert.equal(peekDrag(-52, 0, 200).progress, 0.5);
  assert.equal(peekDrag(104, 0, 200).progress, 1);
  assert.equal(peekDrag(-300, 0, 200).progress, 1);
  assert.equal(peekDrag(-20, 0, 200).side, 1);
  assert.equal(peekDrag(20, 0, 200).side, -1);
});
