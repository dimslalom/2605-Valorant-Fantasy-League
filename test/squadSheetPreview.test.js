import test from 'node:test';
import assert from 'node:assert/strict';
import { previewScale } from '../src/lib/squadSheetPreview.js';

test('tall desktop viewport clamps to the max scale', () => {
  assert.equal(previewScale(1200, false), 0.46);
});

test('short viewport returns 0 (no room for a legible preview)', () => {
  assert.equal(previewScale(400, false), 0);
  assert.equal(previewScale(300, true), 0);
});

test('mobile reserve is smaller than desktop, so the same height scores higher', () => {
  const desktop = previewScale(700, false);
  const mobile = previewScale(700, true);
  assert.ok(mobile > desktop);
});

test('mid-range viewport scales between the floor and ceiling', () => {
  const scale = previewScale(700, false);
  assert.ok(scale > 0.28 && scale < 0.46);
});

test('never returns below the min scale once above the room floor', () => {
  const scale = previewScale(523, false); // reserve (522) + 1px of room
  assert.ok(scale >= 0.28);
});
