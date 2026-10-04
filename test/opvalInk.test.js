import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glassVars, inkOn } from '../apps/call/src/lib/ink.js';

test('inkOn picks the readable ink for a team fill', () => {
  assert.equal(inkOn('#49e829'), '#0b0d14');   // LOUD green: dark text
  assert.equal(inkOn('#cf3347'), '#ffffff');   // GE red: white text
  assert.equal(inkOn('#fff'), '#0b0d14');
  assert.equal(inkOn('#000000'), '#ffffff');
  assert.equal(inkOn(undefined), '#ffffff');
});

test('glassVars pairs each fill with its ink and a matching text shadow', () => {
  assert.deepEqual(glassVars('#cf3347'), { '--glass': '#cf3347', '--glass-ink': '#ffffff', '--glass-shadow': 'rgba(0, 0, 0, 0.4)' });
  assert.equal(glassVars('#49e829')['--glass-ink'], '#0b0d14');
});
