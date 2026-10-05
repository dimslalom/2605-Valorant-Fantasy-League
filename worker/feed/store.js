import { judgeMatch } from './validate.js';

// D1 allows 100 bound parameters per statement, so bulk rows go in as one JSON
// parameter and are unpacked with json_each. Each match is a handful of
// statements committed together by db.batch().

const UPSERT_MATCH = `
INSERT INTO feed_matches (match_id, event_id, stage, series, best_of, starts_at, est_end_at, status, stats_rank,
  team1_id, team2_id, team1_name, team2_name, team1_tag, team2_tag, score1, score2, winner, round_id, patch,
  content_hash, first_final_at, ingested_at, updated_at, first_seen_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?24)
ON CONFLICT(match_id) DO UPDATE SET
  event_id = excluded.event_id, stage = excluded.stage, series = excluded.series, best_of = excluded.best_of,
  starts_at = excluded.starts_at, est_end_at = excluded.est_end_at, status = excluded.status,
  stats_rank = excluded.stats_rank, team1_id = excluded.team1_id, team2_id = excluded.team2_id,
  team1_name = excluded.team1_name, team2_name = excluded.team2_name, team1_tag = excluded.team1_tag,
  team2_tag = excluded.team2_tag, score1 = excluded.score1, score2 = excluded.score2, winner = excluded.winner,
  round_id = excluded.round_id, patch = excluded.patch, content_hash = excluded.content_hash,
  first_final_at = COALESCE(feed_matches.first_final_at, excluded.first_final_at),
  ingested_at = excluded.ingested_at, updated_at = excluded.updated_at
WHERE excluded.stats_rank >= feed_matches.stats_rank`;

const UPSERT_MAP = `
INSERT INTO feed_maps (game_id, match_id, map_no, map_name, picked_by, score1, score2, t1_atk, t1_def, t2_atk, t2_def, duration_s)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
ON CONFLICT(game_id) DO UPDATE SET map_name = excluded.map_name, picked_by = excluded.picked_by,
  score1 = excluded.score1, score2 = excluded.score2, t1_atk = excluded.t1_atk, t1_def = excluded.t1_def,
  t2_atk = excluded.t2_atk, t2_def = excluded.t2_def, duration_s = excluded.duration_s`;

const INSERT_PLAYER_MAPS = `
INSERT INTO feed_player_maps (game_id, vlr_id, match_id, side, team_tag, agent, r2, acs, k, d, a, kast, adr, hs, fk, fd,
  mk2, mk3, mk4, mk5, cl1, cl2, cl3, cl4, cl5, sides)
SELECT ?1, json_extract(value, '$.vlrId'), ?2, json_extract(value, '$.side'), json_extract(value, '$.teamTag'),
  json_extract(value, '$.agent'), json_extract(value, '$.r2'), json_extract(value, '$.acs'), json_extract(value, '$.k'),
  json_extract(value, '$.d'), json_extract(value, '$.a'), json_extract(value, '$.kast'), json_extract(value, '$.adr'),
  json_extract(value, '$.hs'), json_extract(value, '$.fk'), json_extract(value, '$.fd'),
  json_extract(value, '$.mk[0]'), json_extract(value, '$.mk[1]'), json_extract(value, '$.mk[2]'), json_extract(value, '$.mk[3]'),
  json_extract(value, '$.cl[0]'), json_extract(value, '$.cl[1]'), json_extract(value, '$.cl[2]'),
  json_extract(value, '$.cl[3]'), json_extract(value, '$.cl[4]'),
  json_extract(value, '$.sides')
FROM json_each(?3)`;

// ?3 is when the match started. A re-ingested older match never overwrites a newer team tag.
const UPSERT_PLAYERS = `
INSERT INTO feed_players (vlr_id, handle, country, team_tag, first_seen_at, updated_at, last_played_at)
SELECT json_extract(value, '$.vlrId'), json_extract(value, '$.handle'), json_extract(value, '$.country'),
  json_extract(value, '$.teamTag'), ?1, ?1, ?3
FROM json_each(?2) WHERE true
ON CONFLICT(vlr_id) DO UPDATE SET handle = excluded.handle,
  team_tag = CASE WHEN excluded.last_played_at >= COALESCE(feed_players.last_played_at, 0)
    THEN excluded.team_tag ELSE feed_players.team_tag END,
  last_played_at = MAX(COALESCE(feed_players.last_played_at, 0), excluded.last_played_at),
  country = COALESCE(excluded.country, feed_players.country), updated_at = excluded.updated_at`;

const orNull = v => (v === undefined ? null : v);

// Upcoming matches have no player rows, so the match page gives no team tag. Reuse the
// tag the same team (by vlr id) already has in the feed.
async function knownTag(db, teamId) {
  if (teamId == null) return null;
  const row = await db.prepare(
    `SELECT tag FROM (
       SELECT team1_tag AS tag FROM feed_matches WHERE team1_id = ?1 AND team1_tag != ''
       UNION SELECT team2_tag AS tag FROM feed_matches WHERE team2_id = ?1 AND team2_tag != ''
     ) LIMIT 1`,
  ).bind(teamId).first();
  return row?.tag ?? null;
}

// Ingest a `kind: "matches"` payload. Returns the per-match outcome lists.
export async function ingestMatches(db, payload, now = Math.floor(Date.now() / 1000)) {
  const out = { accepted: [], unchanged: [], partial: [], rejected: [] };

  for (const match of payload.matches ?? []) {
    const judged = judgeMatch(match);
    if (judged.verdict === 'reject') {
      out.rejected.push({ id: match.matchId ?? null, reason: judged.reason });
      continue;
    }

    const existing = await db
      .prepare('SELECT stats_rank, content_hash FROM feed_matches WHERE match_id = ?1')
      .bind(match.matchId)
      .first();
    if (existing && judged.statsRank < existing.stats_rank) {
      out.unchanged.push(match.matchId);
      continue;
    }
    if (existing && existing.content_hash && existing.content_hash === match.contentHash
        && judged.statsRank === existing.stats_rank) {
      out.unchanged.push(match.matchId);
      continue;
    }

    const [t1 = {}, t2 = {}] = match.teams ?? [];
    for (const t of [t1, t2]) if (!t.tag) t.tag = (await knownTag(db, t.vlrTeamId)) ?? '';
    const statements = [
      db.prepare(UPSERT_MATCH).bind(
        match.matchId, match.eventId, orNull(match.stage), orNull(match.series), orNull(match.bestOf),
        orNull(match.startsAt), orNull(match.estEndAt), match.status, judged.statsRank,
        orNull(t1.vlrTeamId), orNull(t2.vlrTeamId), orNull(t1.name), orNull(t2.name), orNull(t1.tag), orNull(t2.tag),
        orNull(t1.score), orNull(t2.score), orNull(match.winner), orNull(match.roundId), orNull(match.patch),
        orNull(match.contentHash), match.status === 'final' ? now : null, now, now,
      ),
    ];

    (match.maps ?? []).forEach((map, i) => {
      const h = map.halves ?? {};
      statements.push(db.prepare(UPSERT_MAP).bind(
        map.gameId, match.matchId, map.mapNo ?? i + 1, map.map, orNull(map.pickedBy), map.score[0], map.score[1],
        orNull(h.t1?.atk), orNull(h.t1?.def), orNull(h.t2?.atk), orNull(h.t2?.def), orNull(map.durationS),
      ));
      // Player rows are replaced only for maps that arrive with ten valid players.
      if (judged.maps[i] === 'ok') {
        const rows = map.players.map(p => ({
          ...p, sides: JSON.stringify({ atk: p.atk ?? null, def: p.def ?? null }),
        }));
        statements.push(db.prepare('DELETE FROM feed_player_maps WHERE game_id = ?1').bind(map.gameId));
        statements.push(db.prepare(INSERT_PLAYER_MAPS).bind(map.gameId, match.matchId, JSON.stringify(rows)));
        statements.push(db.prepare(UPSERT_PLAYERS).bind(now, JSON.stringify(map.players), match.startsAt ?? now));
      }
    });

    await db.batch(statements);
    (judged.verdict === 'partial' ? out.partial : out.accepted).push(
      judged.verdict === 'partial' ? { id: match.matchId, maps: judged.maps } : match.matchId,
    );
  }
  return out;
}

export async function recordSource(db, source, { ok, error = null }, now = Math.floor(Date.now() / 1000)) {
  await db.prepare(
    `INSERT INTO feed_sources (source, last_attempt_at, last_success_at, last_error) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(source) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
       last_success_at = COALESCE(excluded.last_success_at, feed_sources.last_success_at),
       last_error = excluded.last_error`,
  ).bind(source, now, ok ? now : null, error).run();
}
