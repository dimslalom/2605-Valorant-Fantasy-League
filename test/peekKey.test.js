import test from 'node:test';
import assert from 'node:assert/strict';
import { isTypingTarget } from '../src/lib/usePeekKey.js';

// Plain duck-typed stand-ins for DOM elements — no jsdom in this project,
// and isTypingTarget only reads tagName / isContentEditable / getAttribute.
const el = (props) => ({ getAttribute: () => null, ...props });

test('null/undefined target is never a typing target', () => {
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
});

test('input and textarea are typing targets', () => {
  assert.equal(isTypingTarget(el({ tagName: 'INPUT' })), true);
  assert.equal(isTypingTarget(el({ tagName: 'TEXTAREA' })), true);
});

test('a plain div is not a typing target', () => {
  assert.equal(isTypingTarget(el({ tagName: 'DIV' })), false);
});

test('contenteditable is a typing target regardless of tag', () => {
  assert.equal(isTypingTarget(el({ tagName: 'SPAN', isContentEditable: true })), true);
});

test('an ARIA textbox is a typing target', () => {
  const node = el({ tagName: 'DIV', getAttribute: (name) => (name === 'role' ? 'textbox' : null) });
  assert.equal(isTypingTarget(node), true);
});

test('a button is not a typing target even with other ARIA roles', () => {
  const node = el({ tagName: 'BUTTON', getAttribute: (name) => (name === 'role' ? 'button' : null) });
  assert.equal(isTypingTarget(node), false);
});
