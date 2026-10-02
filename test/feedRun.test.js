import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { d1 } from './helpers/d1Shim.js';
import { handleFeed } from '../worker/feed/routes.js';
import { pickCandidates, runPoll } from '../scripts/feed/run.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/feed/match-753462.v2.json', import.meta.url), 'utf8'));

// A fake world: vlrggapi answers from fixtures, and the "feed" is the real Worker handlers over SQLite.
function world() {
  const env = { DB: d1(), FEED_INGEST_TOKEN: 'secret' };
  const listing = [
    { match_id: '753462', stats_ready: true },
    { match_id: '999999', stats_ready: false },
  ];
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    calls.push(url.pathname + url.search);
    if (url.hostname === 'vlr.test') {
      if (url.pathname === '/v2/events/matches') return Response.json({ data: { segments: listing } });
      if (url.pathname === '/v2/match/details') return Response.json(golden);
    }
    return handleFeed(new Request(url, init), env, url);
  };
  return { env, calls, fetchImpl };
}
const clientsOf = fetchImpl => ({
  vlr: async path => (await (await fetchImpl(`https://vlr.test${path}`)).json()).data,
  feed: {
    async known(id) {
      const res = await fetchImpl(`https://feed.test/api/feed/schedule?event=${id}`);
      return new Map((await res.json()).matches.map(m => [m.matchId, m]));
    },
    async ingest(body) {
      const res = await fetchImpl('https://feed.test/internal/ingest', {
        method: 'POST', headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return res.json();
    },
  },
});

test('pickCandidates skips matches without published stats and ones already complete', () => {
  const listing = [{ match_id: '1', stats_ready: true }, { match_id: '2', stats_ready: false }, { match_id: '3', stats_ready: true }];
  const known = new Map([[3, { statsRank: 3 }]]);
  assert.deepEqual(pickCandidates(listing, known).map(r => r.match_id), ['1']);
});

test('poll end to end: vlrggapi match -> normalize -> Worker -> readable from the public API', async () => {
  const w = world();
  const summary = await runPoll({ clients: clientsOf(w.fetchImpl), events: [{ id: 2766 }], runId: 't1', log: () => {} });
  assert.equal(summary.fetched, 1);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.markupChanged, false);

  const match = await (await w.fetchImpl('https://feed.test/api/feed/matches/753462')).json();
  assert.equal(match.maps.length, 2);
  assert.equal(match.maps[0].players.length, 10);
  assert.equal(match.teams[1].tag, 'NS');
  assert.equal(match.roundId, '2766:2026-10-01');
  assert.equal(w.env.DB.sqlite.prepare('SELECT count(*) c FROM feed_player_maps').get().c, 20);
  const meta = await (await w.fetchImpl('https://feed.test/api/feed/meta')).json();
  assert.equal(meta.stale, false);
});

test('a second poll fetches nothing: the match is already complete in the feed', async () => {
  const w = world();
  await runPoll({ clients: clientsOf(w.fetchImpl), events: [{ id: 2766 }], runId: 't1', log: () => {} });
  const again = await runPoll({ clients: clientsOf(w.fetchImpl), events: [{ id: 2766 }], runId: 't2', log: () => {} });
  assert.equal(again.fetched, 0);
});

test('stats listed as ready but no player rows raises markupChanged', async () => {
  const w = world();
  const broken = JSON.parse(JSON.stringify(golden));
  for (const m of broken.data.segments[0].maps) m.players = { team1: [], team2: [] };
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.pathname === '/v2/match/details') return Response.json(broken);
    return w.fetchImpl(input, init);
  };
  const summary = await runPoll({ clients: clientsOf(fetchImpl), events: [{ id: 2766 }], runId: 't3', log: () => {} });
  assert.equal(summary.markupChanged, true);
});
