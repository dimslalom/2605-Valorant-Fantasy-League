import test from 'node:test';
import assert from 'node:assert/strict';
import { d1 } from './helpers/d1Shim.js';
import { ingestMatches } from '../worker/feed/store.js';

const player = (vlrId, side, k = 18) => ({
  vlrId, side, handle: `p${vlrId}`, teamTag: side === 1 ? 'XLG' : 'NS', country: 'cn', agent: 'omen',
  r2: 1.1, acs: 220, k, d: 16, a: 5, kast: 72, adr: 150, hs: 25, fk: 2, fd: 2,
  mk: [3, 1, 0, 0], cl: [1, 0, 0, 0, 0], atk: { k: 9 }, def: { k: 9 },
});
const roster = (k) => [1, 2, 3, 4, 5].map(i => player(i, 1, k)).concat([6, 7, 8, 9, 10].map(i => player(i, 2, k)));
const map = (gameId, score, players) => ({ gameId, mapNo: gameId - 100, map: 'Summit', pickedBy: 1, score, players });
const match = (maps, extra = {}) => ({
  matchId: 753462, eventId: 2766, stage: 'Group Stage', series: 'Elimination (D)', bestOf: 3, status: 'final',
  startsAt: 1790841900, estEndAt: 1790851000, teams: [{ vlrTeamId: 1, name: 'XLG', tag: 'XLG', score: 0 }, { vlrTeamId: 2, name: 'NS', tag: 'NS', score: 2 }],
  winner: 2, contentHash: 'h1', maps, ...extra,
});
const count = (db, table) => db.sqlite.prepare(`SELECT count(*) c FROM ${table}`).get().c;

test('a complete final match stores the match, both maps and twenty player rows', async () => {
  const db = d1();
  const res = await ingestMatches(db, { matches: [match([map(101, [11, 13], roster()), map(102, [11, 13], roster())])] });
  assert.deepEqual(res.accepted, [753462]);
  assert.equal(count(db, 'feed_matches'), 1);
  assert.equal(count(db, 'feed_maps'), 2);
  assert.equal(count(db, 'feed_player_maps'), 20);
  assert.equal(count(db, 'feed_players'), 10);
  const row = db.sqlite.prepare('SELECT * FROM feed_player_maps WHERE game_id = 101 AND vlr_id = 1').get();
  assert.equal(row.k, 18);
  assert.equal(row.mk3, 1);
  assert.equal(row.cl1, 1);
});

test('re-sending an identical match writes nothing and reports unchanged', async () => {
  const db = d1();
  const m = match([map(101, [11, 13], roster()), map(102, [11, 13], roster())]);
  await ingestMatches(db, { matches: [m] });
  const res = await ingestMatches(db, { matches: [m] });
  assert.deepEqual(res.unchanged, [753462]);
  assert.equal(count(db, 'feed_player_maps'), 20);
});

test('a stats-pending payload never overwrites complete stored stats', async () => {
  const db = d1();
  await ingestMatches(db, { matches: [match([map(101, [11, 13], roster()), map(102, [11, 13], roster())])] });
  const pending = match([map(101, [11, 13], []), map(102, [11, 13], [])], { contentHash: 'h2' });
  const res = await ingestMatches(db, { matches: [pending] });
  assert.deepEqual(res.unchanged, [753462]);
  assert.equal(count(db, 'feed_player_maps'), 20);
  assert.equal(db.sqlite.prepare('SELECT stats_rank FROM feed_matches').get().stats_rank, 3);
});

test('pending first, then complete: rows arrive on the later payload', async () => {
  const db = d1();
  await ingestMatches(db, { matches: [match([map(101, [11, 13], []), map(102, [11, 13], [])])] });
  assert.equal(count(db, 'feed_player_maps'), 0);
  assert.equal(db.sqlite.prepare('SELECT stats_rank FROM feed_matches').get().stats_rank, 1);
  const res = await ingestMatches(db, { matches: [match([map(101, [11, 13], roster()), map(102, [11, 13], roster())], { contentHash: 'h2' })] });
  assert.deepEqual(res.accepted, [753462]);
  assert.equal(count(db, 'feed_player_maps'), 20);
});

test('corrected stats replace the old rows for that map', async () => {
  const db = d1();
  await ingestMatches(db, { matches: [match([map(101, [11, 13], roster(18)), map(102, [11, 13], roster(18))])] });
  await ingestMatches(db, { matches: [match([map(101, [11, 13], roster(25)), map(102, [11, 13], roster(18))], { contentHash: 'h2' })] });
  assert.equal(db.sqlite.prepare('SELECT k FROM feed_player_maps WHERE game_id = 101 AND vlr_id = 1').get().k, 25);
  assert.equal(count(db, 'feed_player_maps'), 20);
});

test('an invalid match is rejected and writes nothing', async () => {
  const db = d1();
  const bad = match([map(101, [11, 13], roster().map((p, i) => (i === 0 ? { ...p, k: 999 } : p))), map(102, [11, 13], roster())]);
  const res = await ingestMatches(db, { matches: [bad] });
  assert.equal(res.rejected.length, 1);
  assert.equal(count(db, 'feed_matches'), 0);
});

test('an upcoming match takes its team tags from teams the feed already knows', async () => {
  const db = d1();
  await ingestMatches(db, { matches: [match([map(101, [11, 13], roster()), map(102, [11, 13], roster())])] });
  const upcoming = {
    matchId: 900, eventId: 2766, status: 'upcoming', bestOf: 3, startsAt: 1791000000, maps: [],
    teams: [{ vlrTeamId: 1, name: 'XLG', tag: '' , score: null }, { vlrTeamId: 2, name: 'NS', tag: '', score: null }],
  };
  const res = await ingestMatches(db, { matches: [upcoming] });
  assert.deepEqual(res.accepted, [900]);
  const row = db.sqlite.prepare('SELECT team1_tag, team2_tag, status, stats_rank, starts_at FROM feed_matches WHERE match_id = 900').get();
  assert.deepEqual([row.team1_tag, row.team2_tag, row.status, row.stats_rank, row.starts_at], ['XLG', 'NS', 'upcoming', 0, 1791000000]);
});

test('a finished match is never downgraded back to upcoming', async () => {
  const db = d1();
  await ingestMatches(db, { matches: [match([map(101, [11, 13], roster()), map(102, [11, 13], roster())])] });
  const stale = { matchId: 753462, eventId: 2766, status: 'upcoming', bestOf: 3, maps: [], teams: [{ vlrTeamId: 1, name: 'XLG', tag: 'XLG' }, { vlrTeamId: 2, name: 'NS', tag: 'NS' }], contentHash: 'late' };
  const res = await ingestMatches(db, { matches: [stale] });
  assert.deepEqual(res.unchanged, [753462]);
  assert.equal(db.sqlite.prepare('SELECT status FROM feed_matches WHERE match_id = 753462').get().status, 'final');
});

test('players carry when they last played for their team, and an older match never moves them back', async () => {
  const db = d1();
  const tagOf = id => db.sqlite.prepare('SELECT team_tag, last_played_at FROM feed_players WHERE vlr_id = ?').get(id);
  await ingestMatches(db, { matches: [match([map(101, [11, 13], roster()), map(102, [11, 13], roster())])] });
  assert.deepEqual({ ...tagOf(1) }, { team_tag: 'XLG', last_played_at: 1790841900 });
  // Player 1 moves to NS in a later match...
  const moved = roster().map(p => (p.vlrId === 1 ? { ...p, teamTag: 'NS' } : p));
  await ingestMatches(db, { matches: [match([map(201, [11, 13], moved), map(202, [11, 13], moved)], { matchId: 2, startsAt: 1790900000, contentHash: 'b' })] });
  assert.deepEqual({ ...tagOf(1) }, { team_tag: 'NS', last_played_at: 1790900000 });
  // ...and a re-sent older match (new stats, new hash) does not put them back on XLG.
  await ingestMatches(db, { matches: [match([map(101, [12, 13], roster()), map(102, [11, 13], roster())], { contentHash: 'h9' })] });
  assert.deepEqual({ ...tagOf(1) }, { team_tag: 'NS', last_played_at: 1790900000 });
});
