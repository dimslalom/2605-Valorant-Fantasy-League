import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { thumbnailSrc } from '../src/lib/utils.js';

const PLACEHOLDER = '/assets/players/placeholder.png';

test('real photos win; real heads are used as-is', () => {
  assert.equal(thumbnailSrc({ photo: '/assets/players/abo.png', head: '/assets/heads/grey-1.png' }), '/assets/players/abo.png');
  assert.equal(thumbnailSrc({ photo: PLACEHOLDER, head: '/assets/heads/someone.png' }), '/assets/heads/someone.png');
  assert.equal(thumbnailSrc({ photo: PLACEHOLDER }), null);
});

test('grey placeholder heads swap to the full grey bust, and that file exists', () => {
  for (let i = 0; i < 5; i += 1) {
    const src = thumbnailSrc({ photo: PLACEHOLDER, head: `/assets/heads/grey-${i}.png` });
    assert.equal(src, `/assets/heads/grey-${i}-body.png`);
    assert.ok(existsSync(new URL(`../public${src}`, import.meta.url)), src);
  }
});
