import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1Shim.js';
import { createCollection } from '../src/engine/collect/game.js';

const sql = readFileSync(new URL('../scripts/reset-opval-saves-20261004.sql', import.meta.url), 'utf8');

test('account reset replaces every save and creates missing ones without touching credentials', () => {
  const db = d1().sqlite;
  db.prepare("INSERT INTO users (id, username, pw_hash, created_at) VALUES (1, 'alice', 'hash-a', 1), (2, 'bob', 'hash-b', 1)").run();
  db.prepare("INSERT INTO saves (user_id, state, updated_at, version) VALUES (1, ?, 1, 7)")
    .run(JSON.stringify({ collection: [123], credits: 500, history: [{ callPoints: 10 }] }));
  db.exec(sql);
  const rows = db.prepare('SELECT user_id, state, version FROM saves ORDER BY user_id').all();
  assert.deepEqual(rows.map(row => row.version), [8, 1]);
  const keys = Object.keys(createCollection({ seed: 1, now: 1 })).sort();
  for (const row of rows) {
    const state = JSON.parse(row.state);
    assert.deepEqual(Object.keys(state).sort(), keys);
    assert.deepEqual(state.collection, []);
    assert.deepEqual(state.tracked, []);
    assert.deepEqual(state.calls, {});
    assert.deepEqual(state.history, []);
    assert.equal(state.freePacks, 2);
    assert.equal(state.credits, 0);
  }
  assert.deepEqual(db.prepare('SELECT username, pw_hash FROM users ORDER BY id').all().map(row => [row.username, row.pw_hash]), [['alice', 'hash-a'], ['bob', 'hash-b']]);
});
