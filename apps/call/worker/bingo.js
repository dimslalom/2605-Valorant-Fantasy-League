// Bingo cards: GET /api/bingo?day= (the day's slate plus your cards), PUT /api/bingo (save one card),
// GET /api/bingo/score and /api/bingo/leaderboard. A player holds up to BINGO.maxCards cards a day, one
// per slot. Only the owner's own cards are ever returned, so nobody can copy a lineup before it locks.
// Every rule lives in src/lib/bingoSlate.js and bingoCard.js, so a save is checked here, not trusted.
// The first card is free; the credits for an extra one are taken by the client, like packs, because
// credits live in the client's save. The server's limit is the cap on cards per day.
import { BINGO } from '../../../src/engine/collect/rules.js';
import { loadMatch } from '../../../worker/feed/routes.js';
import { SIZE, scoreCard } from '../src/lib/bingoCard.js';
import { checkSave, resultOf, slateDay } from '../src/lib/bingoSlate.js';

export const MAX_BINGO_BYTES = 4096;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const now = () => Math.floor(Date.now() / 1000);
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

// [start, end) in unix seconds for a UTC day, or null if `day` is not a real date.
function bounds(day) {
  if (!DAY.test(day ?? '')) return null;
  const start = Date.parse(`${day}T00:00:00Z`) / 1000;
  return Number.isNaN(start) || slateDay(start) !== day ? null : [start, start + 86400];
}

async function loadSlate(env, [from, to]) {
  const { results } = await env.DB.prepare(
    `SELECT match_id, stage, best_of, starts_at, status, team1_tag, team1_name, team2_tag, team2_name
     FROM feed_matches WHERE starts_at >= ?1 AND starts_at < ?2 ORDER BY starts_at, match_id`,
  ).bind(from, to).all();
  return results.map(r => ({
    matchId: r.match_id, stage: r.stage, bestOf: r.best_of, startsAt: r.starts_at, status: r.status,
    teams: [{ tag: r.team1_tag, name: r.team1_name }, { tag: r.team2_tag, name: r.team2_name }],
  }));
}

const loadCards = async (env, user, day) => (await env.DB.prepare(
  'SELECT slot, cells, version FROM bingo_cards WHERE user_id = ?1 AND day = ?2 ORDER BY slot',
).bind(user.id, day).all()).results;
const cardView = row => ({ slot: row.slot, cells: JSON.parse(row.cells), version: row.version });

// matchId -> result for every match on the slate, from the stored feed. Scoring is always computed
// here from stored stats, never taken from the client.
// ponytail: loads each match with its maps on every read; persist day totals once a slate is fully resolved if this gets slow.
async function loadResults(env, range, t) {
  const out = {};
  for (const m of await loadSlate(env, range)) out[m.matchId] = resultOf(await loadMatch(env, m.matchId), t);
  return out;
}

async function score(user, env, day) {
  const range = bounds(day);
  if (!range) return reply({ error: 'bad day' }, 400);
  const cards = await loadCards(env, user, day);
  if (!cards.length) return reply({ day, scored: [] });
  const results = await loadResults(env, range, now());
  return reply({ day, scored: cards.map(row => ({ slot: row.slot, ...scoreCard({ cells: JSON.parse(row.cells) }, results) })) });
}

const byRank = (a, b) => b.points - a.points || (a.firstLineAt ?? Infinity) - (b.firstLineAt ?? Infinity);

// One day's board. Each player counts once, with their best card: points, then earliest completed
// line, then a shared rank on a true tie. Only usernames and points leave the server, never cells.
// A zero-point player stays unranked.
async function leaderboard(user, env, day) {
  const range = bounds(day);
  if (!range) return reply({ error: 'bad day' }, 400);
  const [results, { results: rows }] = await Promise.all([
    loadResults(env, range, now()),
    env.DB.prepare('SELECT b.user_id, u.username, b.cells FROM bingo_cards b JOIN users u ON u.id = b.user_id WHERE b.day = ?1').bind(day).all(),
  ]);
  const best = new Map();
  for (const r of rows) {
    const { total, firstLineAt } = scoreCard({ cells: JSON.parse(r.cells) }, results);
    const entry = { userId: r.user_id, username: r.username, points: total, firstLineAt };
    if (!best.has(r.user_id) || byRank(entry, best.get(r.user_id)) < 0) best.set(r.user_id, entry);
  }
  const scored = [...best.values()]
    .filter(r => r.points > 0)
    .sort((a, b) => byRank(a, b) || (a.username < b.username ? -1 : 1));
  scored.forEach((r, i) => { r.rank = i > 0 && byRank(scored[i - 1], r) === 0 ? scored[i - 1].rank : i + 1; });
  const mine = scored.find(r => r.userId === user.id);
  return reply({
    day,
    entries: scored.slice(0, 50).map(({ username, points, rank }) => ({ username, points, rank })),
    me: { username: user.username, points: mine?.points ?? 0, rank: mine?.rank ?? null },
  });
}

export async function handleBingo(user, env, url, method, body) {
  if (method === 'GET' && url.pathname !== '/api/bingo') {
    const day = url.searchParams.get('day') ?? slateDay(now());
    return url.pathname === '/api/bingo/score' ? score(user, env, day) : leaderboard(user, env, day);
  }
  if (method === 'GET') {
    const day = url.searchParams.get('day') ?? slateDay(now());
    const range = bounds(day);
    if (!range) return reply({ error: 'bad day' }, 400);
    return reply({
      day, size: SIZE, rules: BINGO, matches: await loadSlate(env, range),
      cards: (await loadCards(env, user, day)).map(cardView),
    });
  }

  const { day, slot, cells, version } = body ?? {};
  const range = bounds(day);
  if (!range || !Array.isArray(cells) || !Number.isInteger(version) || version < 0
    || !Number.isInteger(slot) || slot < 1 || slot > BINGO.maxCards) return reply({ error: 'bad card' }, 400);

  const mine = await loadCards(env, user, day);
  const row = mine.find(c => c.slot === slot);
  const view = () => ({ slot, ...(row ? { cells: JSON.parse(row.cells) } : { cells: null }), version: row?.version ?? 0 });
  if ((row?.version ?? 0) !== version) return reply({ error: 'card changed elsewhere', card: view() }, 409);
  // Slots fill in order, so a player cannot skip a free slot and the cap is exactly maxCards.
  if (!row && slot !== mine.length + 1) return reply({ error: 'bad card' }, 400);

  // Keep only the two fields we understand, so nothing else can be stored.
  const card = { cells: cells.map(c => ({ square: c?.square, matchId: c?.matchId })) };
  const slate = Object.fromEntries((await loadSlate(env, range)).map(m => [m.matchId, m]));
  const errors = checkSave(card, row ? { cells: JSON.parse(row.cells) } : null, slate, now());
  if (errors.length) return reply({ error: errors[0], errors }, 400);

  const json = JSON.stringify(card.cells);
  const res = row
    ? await env.DB.prepare('UPDATE bingo_cards SET cells = ?1, version = version + 1, updated_at = ?2 WHERE user_id = ?3 AND day = ?4 AND slot = ?5 AND version = ?6')
      .bind(json, now(), user.id, day, slot, version).run()
    : await env.DB.prepare('INSERT INTO bingo_cards (user_id, day, slot, cells, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5) ON CONFLICT DO NOTHING')
      .bind(user.id, day, slot, json, now()).run();
  if (res.meta.changes !== 1) {
    const fresh = (await loadCards(env, user, day)).find(c => c.slot === slot);
    return reply({ error: 'card changed elsewhere', card: fresh ? cardView(fresh) : { slot, cells: null, version: 0 } }, 409);
  }
  return reply({ ok: true, slot, version: version + 1 });
}
