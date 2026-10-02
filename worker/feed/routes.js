import { isAuthorized } from './auth.js';
import { ingestMatches, recordSource } from './store.js';
import { MAX_BODY_BYTES, validateEnvelope } from './validate.js';

// Feed routes: POST /internal/ingest (bearer) and read-only GET /api/feed/*.
// Raw stats only. Points are computed by the client's shared scoring module,
// so a rule change never needs a re-ingest.

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function reply(body, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, ...SECURITY },
  });
}

const PUBLIC_CACHE = 'public, max-age=30, s-maxage=60, stale-while-revalidate=300';

async function readBody(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    const error = new Error('payload too large');
    error.status = 413;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('invalid json');
    error.status = 400;
    throw error;
  }
}

async function postIngest(request, env) {
  if (!(await isAuthorized(request, env))) return reply({ error: 'unauthorized' }, 401);
  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    return reply({ error: error.message }, error.status ?? 400);
  }
  const envelope = validateEnvelope(body);
  if (!envelope.ok) return reply({ error: envelope.error }, envelope.status);

  const now = Math.floor(Date.now() / 1000);
  if (body.kind === 'matches') {
    const result = await ingestMatches(env.DB, body, now);
    await recordSource(env.DB, 'matches', { ok: true }, now);
    return reply(result);
  }
  if (body.kind === 'heartbeat') {
    await recordSource(env.DB, 'heartbeat', { ok: true }, now);
    return reply({ ok: true });
  }
  // schedule/players/transfers/values/contracts land in later slices.
  return reply({ error: `kind ${body.kind} is not implemented yet` }, 501);
}

async function getMeta(env) {
  const { results } = await env.DB.prepare('SELECT * FROM feed_sources').all();
  const staleMinutes = Number(env.FEED_STALE_MINUTES ?? 120);
  const now = Math.floor(Date.now() / 1000);
  const sources = {};
  for (const row of results) {
    sources[row.source] = {
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
    };
  }
  const last = Math.max(0, ...results.map(r => r.last_success_at ?? 0));
  return reply({
    schemaVersion: 1,
    generatedAt: now,
    attribution: env.FEED_ATTRIBUTION ?? 'Data: vlr.gg',
    sources,
    stale: last > 0 ? now - last > staleMinutes * 60 : true,
  }, 200, PUBLIC_CACHE);
}

const matchRow = r => ({
  matchId: r.match_id, eventId: r.event_id, stage: r.stage, series: r.series, bestOf: r.best_of,
  startsAt: r.starts_at, status: r.status, statsRank: r.stats_rank, roundId: r.round_id,
  teams: [
    { id: r.team1_id, name: r.team1_name, tag: r.team1_tag, score: r.score1 },
    { id: r.team2_id, name: r.team2_name, tag: r.team2_tag, score: r.score2 },
  ],
  winner: r.winner,
});

async function getSchedule(env, url) {
  const event = Number(url.searchParams.get('event'));
  if (!Number.isInteger(event) || event <= 0) return reply({ error: 'event required' }, 400);
  const { results } = await env.DB
    .prepare('SELECT * FROM feed_matches WHERE event_id = ?1 ORDER BY starts_at, match_id')
    .bind(event).all();
  return reply({ event, matches: results.map(matchRow) }, 200, PUBLIC_CACHE);
}

async function loadMatch(env, id) {
  const match = await env.DB.prepare('SELECT * FROM feed_matches WHERE match_id = ?1').bind(id).first();
  if (!match) return null;
  const maps = (await env.DB
    .prepare('SELECT * FROM feed_maps WHERE match_id = ?1 ORDER BY map_no').bind(id).all()).results;
  const rows = (await env.DB
    .prepare(`SELECT pm.*, p.handle FROM feed_player_maps pm
              LEFT JOIN feed_players p ON p.vlr_id = pm.vlr_id WHERE pm.match_id = ?1`).bind(id).all()).results;
  return {
    ...matchRow(match),
    maps: maps.map(m => ({
      gameId: m.game_id, mapNo: m.map_no, map: m.map_name, pickedBy: m.picked_by, score: [m.score1, m.score2],
      players: rows.filter(p => p.game_id === m.game_id).map(p => ({
        vlrId: p.vlr_id, handle: p.handle, side: p.side, teamTag: p.team_tag, agent: p.agent, r2: p.r2, acs: p.acs,
        k: p.k, d: p.d, a: p.a, kast: p.kast, adr: p.adr, hs: p.hs, fk: p.fk, fd: p.fd,
        mk: [p.mk2, p.mk3, p.mk4, p.mk5], cl: [p.cl1, p.cl2, p.cl3, p.cl4, p.cl5],
      })),
    })),
  };
}

async function getMatch(env, id) {
  const match = await loadMatch(env, id);
  return match ? reply(match, 200, PUBLIC_CACHE) : reply({ error: 'not found' }, 404);
}

async function getRound(env, roundId) {
  const { results } = await env.DB
    .prepare('SELECT match_id FROM feed_matches WHERE round_id = ?1 ORDER BY starts_at').bind(roundId).all();
  const matches = [];
  for (const r of results) matches.push(await loadMatch(env, r.match_id));
  return reply({ roundId, matches }, 200, PUBLIC_CACHE);
}

export async function handleFeed(request, env, url) {
  const path = url.pathname;
  if (path === '/internal/ingest') {
    return request.method === 'POST' ? postIngest(request, env) : reply({ error: 'method not allowed' }, 405);
  }
  if (request.method !== 'GET') return reply({ error: 'method not allowed' }, 405);
  if (path === '/api/feed/meta') return getMeta(env);
  if (path === '/api/feed/schedule') return getSchedule(env, url);
  let m;
  if ((m = path.match(/^\/api\/feed\/matches\/(\d+)$/))) return getMatch(env, Number(m[1]));
  if ((m = path.match(/^\/api\/feed\/rounds\/([^/]+)$/))) return getRound(env, decodeURIComponent(m[1]));
  return reply({ error: 'not found' }, 404);
}
