-- When each player last played for the team they are tagged with. vlr.gg gives no departures,
-- so a player who left keeps the old tag until they play elsewhere; rosters use this to drop them.
-- The ALTER goes first so a second, parallel apply fails before changing anything.

ALTER TABLE feed_players ADD COLUMN last_played_at INTEGER;

-- Ingest used to let an older match, ingested later, overwrite a newer team tag. Reset every
-- tag to the team of the player's latest match, then stamp when that was.
UPDATE feed_players SET team_tag = (
  SELECT pm.team_tag FROM feed_player_maps pm JOIN feed_matches m ON m.match_id = pm.match_id
  WHERE pm.vlr_id = feed_players.vlr_id ORDER BY m.starts_at DESC, m.match_id DESC LIMIT 1
) WHERE EXISTS (SELECT 1 FROM feed_player_maps pm WHERE pm.vlr_id = feed_players.vlr_id);

UPDATE feed_players SET last_played_at = (
  SELECT MAX(m.starts_at) FROM feed_player_maps pm JOIN feed_matches m ON m.match_id = pm.match_id
  WHERE pm.vlr_id = feed_players.vlr_id AND pm.team_tag = feed_players.team_tag
);
