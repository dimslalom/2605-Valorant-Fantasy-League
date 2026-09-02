import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DUR, EASE, STAGGER, PACK_STAGGER } from '../src/lib/motion.js';

// Parses src/styles/tokens.css and asserts src/lib/motion.js mirrors it
// exactly. The Impeccable design-lint detector has no motion rule, so this
// test is the only thing that catches a Framer Motion duration or easing
// drifting from the CSS source of truth.

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(join(__dirname, '../src/styles/tokens.css'), 'utf8');

function cssVar(name) {
  const match = tokensCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`--${name} not found in tokens.css`);
  return match[1].trim();
}

function msToSeconds(msValue) {
  const ms = Number.parseFloat(msValue.replace('ms', ''));
  return ms / 1000;
}

function parseCubicBezier(value) {
  const match = value.match(/cubic-bezier\(([^)]+)\)/);
  return match[1].split(',').map(n => Number.parseFloat(n.trim()));
}

test('DUR mirrors --dur-* tokens (ms -> seconds)', () => {
  assert.equal(DUR.micro, msToSeconds(cssVar('dur-micro')));
  assert.equal(DUR.hover, msToSeconds(cssVar('dur-hover')));
  assert.equal(DUR.transform, msToSeconds(cssVar('dur-transform')));
  assert.equal(DUR.enter, msToSeconds(cssVar('dur-enter')));
  assert.equal(DUR.hero, msToSeconds(cssVar('dur-hero')));
  assert.equal(DUR.travel, msToSeconds(cssVar('dur-travel')));
});

test('EASE mirrors --ease-* cubic-bezier control points', () => {
  assert.deepEqual(EASE.out, parseCubicBezier(cssVar('ease-out')));
  assert.deepEqual(EASE.in, parseCubicBezier(cssVar('ease-in')));
  assert.deepEqual(EASE.travel, parseCubicBezier(cssVar('ease-travel')));
});

test('STAGGER mirrors --stagger (ms -> seconds)', () => {
  assert.equal(STAGGER, msToSeconds(cssVar('stagger')));
  assert.equal(PACK_STAGGER, msToSeconds(cssVar('pack-stagger')));
});
