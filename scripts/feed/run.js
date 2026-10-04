// Feed job: pull finished matches from the local vlrggapi, normalize, POST to the Worker.
//   node scripts/feed/run.js --mode poll
//   node scripts/feed/run.js --mode backfill --event 2766 [--limit 40]
//
// Env: VLR_API_BASE (default http://127.0.0.1:3001), FEED_BASE_URL, FEED_INGEST_TOKEN.
// Exit codes: 0 ok, 1 failure, 2 MARKUP_CHANGED (a finished match came back without stats).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { normalizeMatch } from './normalize.js';

const MAX_PER_RUN = 6;
const roundIdOf = (eventId, startsAt) =>
  `${eventId}:${startsAt ? new Date(startsAt * 1000).toISOString().slice(0, 10) : 'tbd'}`;

export function makeClients({ vlrBase, feedBase, token, fetchImpl = fetch }) {
  const vlr = async path => {
    const res = await fetchImpl(`${vlrBase}${path}`);
    if (!res.ok) throw new Error(`vlrggapi ${path} -> ${res.status}`);
    return (await res.json()).data;
  };
  const feed = {
    async known(eventId) {
      const res = await fetchImpl(`${feedBase}/api/feed/schedule?event=${eventId}`);
      if (!res.ok) throw new Error(`feed schedule -> ${res.status}`);
      const { matches } = await res.json();
      return new Map(matches.map(m => [m.matchId, m]));
    },
    async ingest(body) {
      const res = await fetchImpl(`${feedBase}/internal/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`ingest -> ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
  return { vlr, feed };
}

// Which matches need (re)fetching: finished with stats published, and either
// unknown to the feed or stored with worse stats than the listing now offers.
export function pickCandidates(listing, known, limit = MAX_PER_RUN) {
  return listing
    .filter(row => row.match_id && row.stats_ready)
    .filter(row => {
      const stored = known.get(Number(row.match_id));
      return !stored || stored.statsRank < 3;
    })
    .slice(0, limit);
}

// "2h 15m", "1d 3h", "1w 2d" -> minutes. Unknown formats count as far away.
export function etaMinutes(text) {
  if (!text) return Infinity;
  const unit = { w: 10080, d: 1440, h: 60, m: 1 };
  let total = 0;
  let found = false;
  for (const [, n, u] of String(text).matchAll(/(\d+)\s*([wdhm])/g)) { total += Number(n) * unit[u]; found = true; }
  return found ? total : Infinity;
}

// Refresh known upcoming matches every run, including ones moved beyond the usual
// horizon. New matches enter the feed only when they are near.
// Placeholder playoff slots ("TBD") have no teams to call, so they are skipped.
export function pickWindow(listing, known, { horizonMinutes = 48 * 60, limit = 10 } = {}) {
  const real = row => row.match_id && ![row.team1?.name, row.team2?.name].some(n => !n || /^tbd$/i.test(n.trim()));
  const picked = [];
  for (const row of listing.filter(real)) {
    const status = String(row.status ?? '').toLowerCase();
    const stored = known.get(Number(row.match_id));
    if (status === 'live') picked.push({ row, status: 'live' });
    else if (status === 'upcoming' && stored?.status !== 'final'
        && (stored || etaMinutes(row.eta) <= horizonMinutes)) picked.push({ row, status: 'upcoming' });
  }
  return picked.slice(0, limit);
}

export async function runPoll({ clients, events, runId, limit = MAX_PER_RUN, log = console.log }) {
  const summary = { fetched: 0, accepted: 0, upcoming: 0, pending: 0, rejected: 0, markupChanged: false };
  for (const event of events) {
    const listing = (await clients.vlr(`/v2/events/matches?event_id=${event.id}`)).segments ?? [];
    const known = await clients.feed.known(event.id);
    const candidates = pickCandidates(listing, known, limit);
    log(`event ${event.id}: ${listing.length} listed, ${candidates.length} to fetch`);
    for (const row of candidates) {
      const detail = (await clients.vlr(`/v2/match/details?match_id=${row.match_id}`)).segments[0];
      const match = normalizeMatch(detail, {});
      match.roundId = roundIdOf(event.id, match.startsAt);
      summary.fetched += 1;
      const result = await clients.feed.ingest({
        schemaVersion: 1, kind: 'matches', runId, source: { name: 'vlr.gg' }, matches: [match],
      });
      summary.accepted += result.accepted.length;
      summary.rejected += result.rejected.length;
      // Listing says stats are out but the page had no players: vlr changed its markup.
      if (match.status === 'final' && match.maps.every(m => m.players.length === 0)) {
        summary.markupChanged = true;
      }
      log(`  match ${row.match_id}: ${JSON.stringify(result)}`);
    }
  }
  for (const event of events) {
    const listing = (await clients.vlr(`/v2/events/matches?event_id=${event.id}`)).segments ?? [];
    const known = await clients.feed.known(event.id);
    const windowRows = pickWindow(listing, known);
    log(`event ${event.id}: ${windowRows.length} live or upcoming to refresh`);
    for (const { row, status } of windowRows) {
      const detail = (await clients.vlr(`/v2/match/details?match_id=${row.match_id}`)).segments[0];
      const match = normalizeMatch(detail, { status });
      match.roundId = roundIdOf(event.id, match.startsAt);
      const result = await clients.feed.ingest({ schemaVersion: 1, kind: 'matches', runId, source: { name: 'vlr.gg' }, matches: [match] });
      summary.upcoming += result.accepted.length;
      log(`  ${status} ${row.match_id}: ${JSON.stringify(result)}`);
    }
  }
  await clients.feed.ingest({ schemaVersion: 1, kind: 'heartbeat', runId });
  return summary;
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  const clients = makeClients({
    vlrBase: process.env.VLR_API_BASE ?? 'http://127.0.0.1:3001',
    feedBase: process.env.FEED_BASE_URL ?? 'http://127.0.0.1:8787',
    token: process.env.FEED_INGEST_TOKEN ?? 'local-dev',
  });
  const config = JSON.parse(readFileSync(new URL('./events.json', import.meta.url), 'utf8'));
  const events = args.event ? [{ id: Number(args.event) }] : config.tracked;
  const runId = process.env.GITHUB_RUN_ID ? `gh-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}` : `local-${Date.now()}`;
  const summary = await runPoll({ clients, events, runId, limit: Number(args.limit ?? MAX_PER_RUN) });
  console.log(JSON.stringify(summary));
  if (summary.markupChanged) {
    console.error('MARKUP_CHANGED: a finished match returned no player rows');
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error); process.exit(1); });
}
