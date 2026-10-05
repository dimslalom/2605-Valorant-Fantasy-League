import test from 'node:test';
import assert from 'node:assert/strict';
import { d1 } from './helpers/d1Shim.js';
import { settleAll } from '../apps/call/worker/settle.js';
import { createCollection } from '../src/engine/collect/game.js';
import { CALL } from '../src/engine/collect/rules.js';

test('cron rescores a save from the old call values with nothing new to settle, paying the wallet once', async () => {
  const db = d1();
  db.sqlite.prepare("INSERT INTO users (id, username, pw_hash, created_at) VALUES (1, 'alice', 'h', 1)").run();
  // One unrelated final match, so the cron has something to look at.
  db.sqlite.prepare(`INSERT INTO feed_matches (match_id, event_id, best_of, starts_at, status, stats_rank, team1_tag, team2_tag, winner, updated_at, ingested_at)
    VALUES (9, 1, 3, 100, 'final', 3, 'AAA', 'BBB', 1, 1, 1)`).run();
  // Rule 1: a right winner call (10) at a 1.0 streak, already revealed.
  const result = { winnerRight: true, scoreRight: false, starRight: false, multiplier: 1, total: 10,
    lines: { winner: 10, exactScore: 0, star: 0, backing: 0, againstGrain: 0 } };
  const save = { ...createCollection({ seed: 1, now: 1000 }), credits: 50,
    calls: { 7: { winner: 'AAA' } },
    revealed: { 7: { matchId: 7, callPoints: 10, trackedPoints: 0, total: 10, result } },
    history: [{ matchId: 7, callPoints: 10, trackedPoints: 0, called: true, right: true }] };
  db.sqlite.prepare('INSERT INTO saves (user_id, state, updated_at, version) VALUES (1, ?, 1, 3)').run(JSON.stringify(save));

  const env = { DB: db };
  await settleAll(env, 2000);
  const after = () => JSON.parse(db.sqlite.prepare('SELECT state FROM saves').get().state);
  const wallet = () => db.sqlite.prepare('SELECT balance FROM wallets WHERE user_id = 1').get().balance;
  assert.equal(after().history[0].callPoints, CALL.winner);
  assert.equal(after().callRules, 2);
  assert.equal(wallet(), 50 + CALL.winner - 10);
  await settleAll(env, 3000);   // nothing left to do: no second payment
  assert.equal(wallet(), 50 + CALL.winner - 10);
  assert.deepEqual(after().calls, save.calls);
});
