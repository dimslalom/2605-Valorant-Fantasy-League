import { createHash } from 'node:crypto';

// Turns one vlrggapi /v2/match/details segment into the feed's ingest shape
// (see worker/feed/validate.js). Pure: no network, no clock.

const toInt = v => {
  const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};
const toNum = v => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
};
const unixOf = utc => (utc ? Math.floor(Date.parse(`${utc.replace(' ', 'T')}Z`) / 1000) : null);

// The performance tab has no player link, so rows are joined by name + tag.
const perfKey = (name, tag) => `${String(name).trim().toLowerCase()}|${String(tag).trim().toLowerCase()}`;

function normalizePlayer(row, side, perf, sidesOf) {
  const adv = perf.get(perfKey(row.name, row.team_tag)) ?? {};
  const count = label => toInt(adv[label]) ?? 0;
  return {
    vlrId: row.player_id,
    handle: row.name,
    side,
    teamTag: row.team_tag,
    agent: String(row.agent ?? '').toLowerCase(),
    r2: toNum(row.rating),
    acs: toInt(row.acs),
    k: toInt(row.kills),
    d: toInt(row.deaths),
    a: toInt(row.assists),
    kast: toInt(row.kast),
    adr: toInt(row.adr),
    hs: toInt(row.hs_pct),
    fk: toInt(row.fk),
    fd: toInt(row.fd),
    mk: [count('2K'), count('3K'), count('4K'), count('5K')],
    cl: [count('1v1'), count('1v2'), count('1v3'), count('1v4'), count('1v5')],
    atk: sidesOf(row, 't'),
    def: sidesOf(row, 'ct'),
  };
}

const sideStats = (row, side) => {
  const s = row.sides?.[side] ?? {};
  return { r2: toNum(s.rating), k: toInt(s.kills), d: toInt(s.deaths) };
};

export function normalizeMatch(segment, { roundId = null, status: statusOverride = null } = {}) {
  const status = String(statusOverride ?? segment.status ?? '').toLowerCase();
  const finalMatch = status.includes('final');
  // Live and upcoming matches carry no stats: partial live numbers would only mislead.
  const maps = (finalMatch ? (segment.maps ?? []) : []).map((map, i) => {
    const perfRows = segment.performance?.by_map?.find(p => p.game_id === map.game_id)?.advanced_stats ?? [];
    const perf = new Map(perfRows.map(r => [perfKey(r.player, r.team_tag), r]));
    const players = [
      ...(map.players?.team1 ?? []).map(r => normalizePlayer(r, 1, perf, sideStats)),
      ...(map.players?.team2 ?? []).map(r => normalizePlayer(r, 2, perf, sideStats)),
    ];
    return {
      gameId: toInt(map.game_id),
      mapNo: i + 1,
      map: map.map_name,
      pickedBy: map.picked_side ?? null,
      score: [toInt(map.score?.team1), toInt(map.score?.team2)],
      halves: {
        t1: { atk: toInt(map.score_t?.team1), def: toInt(map.score_ct?.team1) },
        t2: { atk: toInt(map.score_t?.team2), def: toInt(map.score_ct?.team2) },
      },
      players,
    };
  });

  // The match header no longer renders team tags; take them from the players.
  const tagOf = side => maps.flatMap(m => m.players).find(p => p.side === side)?.teamTag ?? '';
  const teams = (segment.teams ?? []).map((t, i) => ({
    vlrTeamId: toInt(t.id),
    name: t.name,
    tag: t.tag || tagOf(i + 1),
    score: toInt(t.score),
  }));
  const winnerIdx = (segment.teams ?? []).findIndex(t => t.is_winner);
  const startsAt = unixOf(segment.start_utc);
  const bestOf = segment.best_of ?? null;

  const match = {
    matchId: toInt(segment.match_id),
    eventId: segment.event_id ?? null,
    stage: segment.event?.series?.split(':')[0]?.trim() ?? null,
    series: segment.event?.series?.split(':').slice(1).join(':').trim() || null,
    bestOf,
    startsAt,
    estEndAt: startsAt && bestOf ? startsAt + (maps.length || bestOf) * 2700 : null,
    status: status.includes('final') ? 'final' : status.includes('live') ? 'live' : 'upcoming',
    patch: segment.patch || null,
    teams,
    winner: winnerIdx >= 0 ? winnerIdx + 1 : null,
    vetoes: segment.map_vetos || null,
    roundId,
    maps,
  };
  match.contentHash = createHash('sha1').update(JSON.stringify({ maps: match.maps, teams: match.teams, status: match.status, startsAt: match.startsAt })).digest('hex');
  return match;
}
