import { settleCalls } from '../../../src/engine/collect/game.js';
import { loadMatch } from '../../../worker/feed/routes.js';

// Scores calls on finished matches for every account, so the leaderboard never waits on a reveal tap.
// It only writes call_settlements, never the save: an open tab may hold newer calls, and a save
// conflict makes that tab reload from the server and drop them. The game moves these points into
// the save (and pays the credits) the next time the player opens it (settleCalls in game.jsx).
// ponytail: re-scores a player's unrevealed calls each run while any is new; fine at this size.
export async function settleAll(env, now = Math.floor(Date.now() / 1000)) {
  const { results } = await env.DB.prepare(`
    SELECT s.user_id, s.state,
      SUM(NOT EXISTS (SELECT 1 FROM call_settlements x WHERE x.user_id = s.user_id AND x.match_id = m.match_id)) AS fresh
    FROM saves s, json_each(s.state, '$.calls') c
    JOIN feed_matches m ON m.match_id = CAST(c.key AS INTEGER)
    WHERE m.status = 'final' AND json_extract(c.value, '$.winner') IS NOT NULL
      AND json_type(s.state, '$.revealed."' || c.key || '"') IS NULL
    GROUP BY s.user_id HAVING fresh > 0`).all();
  if (!results.length) return 0;

  const teams = new Map((await env.DB.prepare('SELECT vlr_id, team_tag FROM feed_players').all())
    .results.map(p => [p.vlr_id, p.team_tag]));
  const teamOf = pid => teams.get(Number(pid)) ?? null;
  const matches = new Map();
  const upsert = env.DB.prepare(`INSERT INTO call_settlements (user_id, match_id, call_points, tracked_points, settled_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, match_id) DO UPDATE SET
    call_points = excluded.call_points, tracked_points = excluded.tracked_points, settled_at = excluded.settled_at`);

  const writes = [];
  for (const row of results) {
    const state = JSON.parse(row.state);
    const open = Object.keys(state.calls).filter(id => !state.revealed[id]);
    for (const id of open) if (!matches.has(id)) matches.set(id, await loadMatch(env, Number(id)));
    const settled = settleCalls(state, open.map(id => matches.get(id)).filter(Boolean), { teamOf });
    for (const id of open) {
      const r = settled.revealed[id];
      if (r) writes.push(upsert.bind(row.user_id, Number(id), r.callPoints, r.trackedPoints, now));
    }
  }
  if (writes.length) await env.DB.batch(writes);
  return writes.length;
}
