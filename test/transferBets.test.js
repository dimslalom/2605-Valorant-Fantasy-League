import test from 'node:test';
import assert from 'node:assert/strict';
import { d1 } from './helpers/d1Shim.js';
import { ingestContracts } from '../worker/feed/roster.js';
import { handleTransferBets, settleTransferBets } from '../apps/call/worker/transferBets.js';
import { publicProfile } from '../apps/call/worker/profile.js';
import { nextLock, payoutOf } from '../apps/call/src/lib/transferBets.js';

const t0 = Date.parse('2026-10-20T00:00:00Z') / 1000;
const lock = nextLock(t0);
const row = (player, team) => ({ player, team, league: 'Pacific', contractEnd: '2027 Season End' });
const rrq = ['monyet', 'crazyguy', 'Jemkin', 'xffero', 'Kushy'].map(p => row(p, 'Rex Regum Qeon'));
const body = res => res.json();

test('payout pays each hit leg its share of stake x (legs + 1)', () => {
  assert.equal(payoutOf(100, 3, 3), 400);
  assert.equal(payoutOf(100, 3, 1), 133);
  assert.equal(payoutOf(100, 1, 0), 0);
});

test('Xavi8k to RRQ replacing monyet and crazyguy: stake, roster lock, partial settle', async () => {
  const db = d1(), env = { DB: db }, user = { id: 1 };
  db.sqlite.prepare("INSERT INTO users(id,username,pw_hash,created_at) VALUES(1,'alpha','x',0)").run();
  db.sqlite.prepare('INSERT INTO saves(user_id,state,updated_at,version) VALUES(1,?,0,1)').run(JSON.stringify({ credits: 300 }));
  await ingestContracts(db, { contracts: [...rrq, row('Xavi8k', 'Team Secret')] }, t0 - 100);

  // Monyet replaced by Xavi8k, Crazyguy leaving for Team Secret: 4 legs.
  const moves = [{ out: 'monyet|pacific', in: 'Xavi8k' }, { out: 'crazyguy|pacific', to: 'Team Secret' }];
  const post = b => handleTransferBets(user, env, 'POST', b, t0);
  assert.equal((await post({ moves: [{ out: 'monyet|pacific', in: 'Jemkin' }], stake: 50 })).status, 400, 'already on the team');
  assert.equal((await post({ moves: [{ out: 'nope|pacific', in: 'Xavi8k' }], stake: 50 })).status, 400, 'not on a team');
  assert.equal((await post({ moves: [{ out: 'monyet|pacific', in: 'Xavi8k', to: 'Team Secret' }], stake: 50 })).status, 400, 'one destination');
  assert.equal((await post({ moves: [{ out: 'monyet|pacific', to: 'Rex Regum Qeon' }], stake: 50 })).status, 400, 'same team');
  assert.equal((await post({ moves, stake: 999 })).status, 400);
  const placed = await body(await post({ moves, stake: 100 }));
  assert.equal(placed.balance, 200);
  assert.equal(placed.bet.deadline, lock);
  assert.equal(placed.bet.legs.length, 4);

  // Xavi8k joins RRQ and monyet leaves; crazyguy stays. Each change needs two Riot reads to confirm.
  const after = [...rrq.filter(r => r.player !== 'monyet'), row('Xavi8k', 'Rex Regum Qeon')];
  await ingestContracts(db, { contracts: after }, t0 + 3600);
  await ingestContracts(db, { contracts: after }, t0 + 7200);
  const live = await body(await handleTransferBets(user, env, 'GET', null, t0 + 7300));
  assert.deepEqual(live.bets[0].legs.map(l => `${l.type}:${l.player}:${l.hit}`), ['leave:monyet:true', 'join:Xavi8k:true', 'leave:crazyguy:false', 'join:crazyguy:false']);

  assert.equal(await settleTransferBets(env, lock + 10), 0, 'waits for two Riot reads after the lock');
  await ingestContracts(db, { contracts: after }, lock + 60);
  await ingestContracts(db, { contracts: after }, lock + 120);
  assert.equal(await settleTransferBets(env, lock + 200), 1);
  assert.equal(await settleTransferBets(env, lock + 300), 0, 'settles once');
  const done = await body(await handleTransferBets(user, env, 'GET', null, lock + 400));
  assert.equal(done.bets[0].hits, 2);
  assert.equal(done.bets[0].payout, 250);
  assert.equal(done.balance, 450);

  const profile = await body(await publicProfile(env, 'alpha', lock + 400));
  assert.equal(profile.guesses[0].payout, 250);
  assert.equal('credits' in profile, false, 'profile is public: no wallet');
  assert.equal((await publicProfile(env, 'nobody', lock)).status, 404);
});
