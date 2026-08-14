import test from 'node:test';
import assert from 'node:assert/strict';
import { headingToward, contains, pad, unionRects, silhouette } from '../src/lib/safeTriangle.js';

// The squad fan as it actually sits: a wide, short band of cards pinned to the
// bottom of a 1440x860 viewport (numbers lifted from a live run).
const FAN = { left: 513, top: 752, right: 927, bottom: 839 };

test('silhouette picks the two widest-apart corners', () => {
  // Straight above the fan: the near (top) corners subtend the widest angle,
  // and the far corners fall inside the cone they span.
  const [a, b] = silhouette(FAN, { x: 720, y: 400 });
  assert.deepEqual([a.y, b.y], [FAN.top, FAN.top]);
  assert.deepEqual([a.x, b.x].sort((p, q) => p - q), [FAN.left, FAN.right]);
  // The cone covers the gap between the pointer and the fan's near edge; past
  // that edge the padded rect takes over, so the triangle stops there.
  assert.ok(headingToward({ x: 720, y: 740 }, { x: 720, y: 400 }, FAN));
  assert.ok(contains(pad(FAN, 16), { x: 720, y: 800 }));
});

test('pointer travelling from the exit toward the fan stays open', () => {
  const exit = { x: 450, y: 700 };                 // just off the top-left
  assert.ok(headingToward({ x: 500, y: 730 }, exit, FAN));   // closing in
  assert.ok(headingToward({ x: 600, y: 745 }, exit, FAN));   // nearly there
  // Diagonal run at the far corner is still inside the cone.
  assert.ok(headingToward({ x: 700, y: 780 }, exit, FAN));
});

test('pointer veering away from the fan closes', () => {
  const exit = { x: 450, y: 700 };
  assert.ok(!headingToward({ x: 380, y: 640 }, exit, FAN));   // back up-left
  assert.ok(!headingToward({ x: 450, y: 500 }, exit, FAN));   // straight up
  assert.ok(!headingToward({ x: 1200, y: 700 }, exit, FAN));  // off sideways
});

test('leaving the fan sideways still allows a sweep back along the cards', () => {
  const exit = { x: 940, y: 800 };                 // off the right edge
  assert.ok(headingToward({ x: 930, y: 800 }, exit, FAN));    // stepping back in
  assert.ok(!headingToward({ x: 1000, y: 860 }, exit, FAN));  // gone for good
});

test('tolerance keeps the gaps between fanned cards inside the target', () => {
  const box = pad(FAN, 16);
  assert.ok(contains(box, { x: 520, y: 760 }));   // empty corner of a rotated card
  assert.ok(contains(box, { x: 927 + 10, y: 839 + 10 })); // just past the edge
  assert.ok(!contains(box, { x: 200, y: 300 }));
});

test('unionRects spans every card', () => {
  const box = unionRects([
    { left: 513, top: 755, right: 592, bottom: 839 },
    { left: 696, top: 752, right: 744, bottom: 826 },
    { left: 848, top: 755, right: 927, bottom: 839 },
  ]);
  assert.deepEqual(box, FAN);
});
