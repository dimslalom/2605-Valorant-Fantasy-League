import test from 'node:test';
import assert from 'node:assert/strict';
import { d1 } from './helpers/d1Shim.js';
import { handleAccounts } from '../apps/call/worker/accounts.js';
import { byId } from '../apps/call/src/lib/bingoSquares.js';
import { slateDay } from '../apps/call/src/lib/bingoSlate.js';
import { BINGO } from '../src/engine/collect/rules.js';

const call = (e, method, path, body, cookie) => {
  const url = new URL(`https://x.test${path}`);
  const headers = { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) };
  return handleAccounts(new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), e, url);
};
const cookieOf = res => res.headers.get('Set-Cookie').split(';')[0];
const P = id => byId[id].points;
const nowS = Math.floor(Date.now() / 1000);
const dayStart = Math.floor(nowS / 86400) * 86400 + 2 * 86400; // two UTC days out, so nothing here has started
const day = slateDay(dayStart);
const pair = (square, matchId) => ({ square, matchId });

async function setup() {
  const e = { DB: d1() };
  const add = (id, startsAt, status = 'upcoming', bestOf = 3) => e.DB.sqlite.prepare(
    `INSERT INTO feed_matches (match_id, event_id, best_of, starts_at, status, team1_tag, team2_tag, updated_at) VALUES (?, 1, ?, ?, ?, 'AAA', 'BBB', 0)`,
  ).run(id, bestOf, startsAt, status);
  [1, 2, 3].forEach(i => add(i, dayStart + i * 3600));
  add(4, dayStart + 7 * 3600, 'live'); // already started as far as the feed is concerned
  add(5, dayStart + 8 * 3600, 'upcoming', 5);
  const res = await call(e, 'POST', '/api/auth/signup', { username: 'bingoer', password: 'correct horse' });
  return { e, cookie: cookieOf(res) };
}
const card = (a = 1, b = 2) => [pair('ot', a), pair('ace', a), pair('ot', b), pair('ace', b)];
const put = (e, cookie, slot, cells, version = 0) => call(e, 'PUT', '/api/bingo', { day, slot, cells, version }, cookie);

test('bingo needs a session', async () => {
  const { e } = await setup();
  assert.equal((await call(e, 'GET', `/api/bingo?day=${day}`)).status, 401);
  assert.equal((await call(e, 'PUT', '/api/bingo', { day, slot: 1, cells: card(), version: 0 })).status, 401);
});

test('GET returns the day slate, the rules, and no cards yet; a bad day is a 400', async () => {
  const { e, cookie } = await setup();
  const body = await (await call(e, 'GET', `/api/bingo?day=${day}`, undefined, cookie)).json();
  assert.deepEqual(body.matches.map(m => m.matchId), [1, 2, 3, 4, 5]);
  assert.deepEqual(body.cards, []);
  assert.equal(body.size, 2);
  assert.deepEqual(body.rules, BINGO);
  for (const bad of ['2026-02-31', 'tomorrow', '2026-1-1']) {
    assert.equal((await call(e, 'GET', `/api/bingo?day=${bad}`, undefined, cookie)).status, 400, bad);
  }
});

test('save, read back, edit with the new version, reject a stale version', async () => {
  const { e, cookie } = await setup();
  assert.deepEqual(await (await put(e, cookie, 1, card())).json(), { ok: true, slot: 1, version: 1 });
  const got = await (await call(e, 'GET', `/api/bingo?day=${day}`, undefined, cookie)).json();
  assert.deepEqual(got.cards, [{ slot: 1, cells: card(), version: 1 }]);

  const edited = card(); edited[0] = pair('k30', 2);
  assert.deepEqual(await (await put(e, cookie, 1, edited, 1)).json(), { ok: true, slot: 1, version: 2 });
  const stale = await put(e, cookie, 1, card(), 1);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).card.version, 2);
  assert.equal((await put(e, cookie, 1, card(), 0)).status, 409);
});

test('up to the cap of cards a day, filled in order, each with its own version', async () => {
  const { e, cookie } = await setup();
  assert.equal((await put(e, cookie, 2, card())).status, 400, 'cannot skip slot 1');
  for (let slot = 1; slot <= BINGO.maxCards; slot += 1) {
    const cells = [pair('ot', 1), pair('ace', 1), pair('ot', 2), pair(['k25', 'fk6', 'c3', 'c4', 'minus12'][slot - 1], 2)];
    assert.equal((await put(e, cookie, slot, cells)).status, 200, `slot ${slot}`);
  }
  assert.equal((await put(e, cookie, BINGO.maxCards + 1, card())).status, 400, 'over the cap');
  assert.equal((await put(e, cookie, 0, card())).status, 400);
  assert.equal((await put(e, cookie, 1.5, card())).status, 400);
  const got = await (await call(e, 'GET', `/api/bingo?day=${day}`, undefined, cookie)).json();
  assert.deepEqual(got.cards.map(c => [c.slot, c.version]), [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
  // Editing slot 3 moves only slot 3.
  assert.equal((await put(e, cookie, 3, card(2, 3), 1)).status, 200);
  const after = await (await call(e, 'GET', `/api/bingo?day=${day}`, undefined, cookie)).json();
  assert.deepEqual(after.cards.map(c => c.version), [1, 1, 2, 1, 1]);
});

test('rejects bad cells: size, unknown square, off-slate, duplicate, started match, map 3 outside a Bo3, junk not stored', async () => {
  const { e, cookie } = await setup();
  const bad = async cells => (await (await put(e, cookie, 1, cells)).json()).error;
  assert.equal((await put(e, cookie, 1, card().slice(1))).status, 400);
  assert.match(await bad([pair('nope', 1), ...card().slice(1)]), /unknown/);
  assert.match(await bad([pair('ot', 99), ...card().slice(1)]), /slate/);
  assert.match(await bad([card()[0], card()[0], ...card().slice(2)]), /duplicate/);
  assert.match(await bad([pair('ot', 4), ...card().slice(1)]), /locked/);
  assert.match(await bad([pair('map3', 5), ...card().slice(1)]), /does not fit/);
  assert.equal((await put(e, cookie, 1, [pair('map3', 1), ...card().slice(1)])).status, 200, 'map 3 fits a Bo3');
  assert.equal((await put(e, cookie, 2, card().map(c => ({ ...c, extra: 'x' })))).status, 200);
  const stored = JSON.parse(e.DB.sqlite.prepare('SELECT cells FROM bingo_cards WHERE slot = 2').get().cells);
  assert.deepEqual(stored, card());
});

test('a card is private to its owner', async () => {
  const { e, cookie } = await setup();
  await put(e, cookie, 1, card());
  const other = await call(e, 'POST', '/api/auth/signup', { username: 'rival', password: 'correct horse' });
  const theirs = await (await call(e, 'GET', `/api/bingo?day=${day}`, undefined, cookieOf(other))).json();
  assert.deepEqual(theirs.cards, []);
});

// Scoring and the day board. Matches 1 and 2 are final with stats; 3 is live (pending).
async function scored() {
  const e = { DB: d1() };
  const t = Math.floor(Date.now() / 1000) - 7200;
  const sq = e.DB.sqlite;
  const match = (id, status, rank, first) => sq.prepare(
    `INSERT INTO feed_matches (match_id, event_id, best_of, starts_at, status, stats_rank, first_final_at, updated_at) VALUES (?, 1, 3, ?, ?, ?, ?, 0)`,
  ).run(id, t, status, rank, first);
  match(1, 'final', 3, 1000); match(2, 'final', 3, 2000); match(3, 'live', 0, null);
  const map = (game, matchId, s1, s2) => sq.prepare('INSERT INTO feed_maps (game_id, match_id, map_no, map_name, score1, score2) VALUES (?, ?, 1, ?, ?, ?)').run(game, matchId, 'Ascent', s1, s2);
  map(10, 1, 13, 12); // overtime, 24+ rounds
  map(20, 2, 13, 4);  // stomp, short
  const user = async name => {
    const res = await call(e, 'POST', '/api/auth/signup', { username: name, password: 'correct horse' });
    return { id: sq.prepare('SELECT id FROM users WHERE username = ?').get(name).id, cookie: cookieOf(res) };
  };
  const give = (u, slot, pairs) => sq.prepare('INSERT INTO bingo_cards (user_id, day, slot, cells, version, updated_at) VALUES (?, ?, ?, ?, 1, 0)')
    .run(u.id, slotDay, slot, JSON.stringify(pairs.map(([square, matchId]) => pair(square, matchId))));
  const slotDay = slateDay(t);
  return { e, day: slotDay, user, give };
}

test('score route scores every card; the leaderboard counts each player once, at their best card', async () => {
  const { e, day: d, user, give } = await scored();
  const [a, b, c] = [await user('alpha'), await user('bravo'), await user('charlie')];
  // alpha card 1: every cell hits (ot and long24 on match 1, short20 and stomp8 on match 2).
  give(a, 1, [['ot', 1], ['long24', 1], ['short20', 2], ['stomp8', 2]]);
  // alpha card 2 is weak: one hit. It must not add to alpha's board score.
  give(a, 2, [['ot', 1], ['ot', 2], ['ace', 3], ['c3', 3]]);
  // bravo: one hit.
  give(b, 1, [['ot', 1], ['stomp8', 1], ['ace', 3], ['c3', 3]]);
  // charlie: nothing hits.
  give(c, 1, [['stomp8', 1], ['short20', 1], ['ot', 2], ['long24', 2]]);

  const mine = (await (await call(e, 'GET', `/api/bingo/score?day=${d}`, undefined, a.cookie)).json()).scored;
  assert.deepEqual(mine.map(s => s.slot), [1, 2]);
  const cells = P('ot') + P('long24') + P('short20') + P('stomp8');
  const lines = Math.max(P('ot'), P('long24')) + (P('ot') + P('short20')) + (P('ot') + P('stomp8'))
    + (P('long24') + P('short20')) + (P('long24') + P('stomp8')) + Math.max(P('short20'), P('stomp8'));
  assert.equal(mine[0].total, cells + lines + cells, 'cells + lines + blackout');
  assert.equal(mine[0].firstLineAt, 1000);
  assert.deepEqual(mine[1].cells, ['hit', 'miss', 'pending', 'pending']);
  assert.equal(mine[1].total, P('ot'));

  const board = await (await call(e, 'GET', `/api/bingo/leaderboard?day=${d}`, undefined, b.cookie)).json();
  assert.deepEqual(board.entries.map(x => [x.username, x.rank, x.points]), [['alpha', 1, mine[0].total], ['bravo', 2, P('ot')]]);
  assert.equal(board.me.points, P('ot'));
  assert.equal(JSON.stringify(board).includes('square'), false);

  const nobody = await (await call(e, 'GET', `/api/bingo/leaderboard?day=${d}`, undefined, c.cookie)).json();
  assert.deepEqual(nobody.me, { username: 'charlie', points: 0, rank: null });
  assert.deepEqual((await (await call(e, 'GET', `/api/bingo/score?day=${d}`, undefined, c.cookie)).json()).scored.length, 1);
  assert.equal((await call(e, 'GET', '/api/bingo/score?day=nope', undefined, a.cookie)).status, 400);
  assert.equal((await call(e, 'GET', `/api/bingo/leaderboard?day=${d}`)).status, 401);
});
