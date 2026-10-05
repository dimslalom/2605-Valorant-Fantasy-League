-- OpVAL: calls the server scored before the player revealed them (apps/call/worker/settle.js).
-- The leaderboard counts a row until that match shows up in the save's `revealed`; after that the
-- save's own history counts it. The server never writes saves, so it can never drop a call.

CREATE TABLE IF NOT EXISTS call_settlements (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id       INTEGER NOT NULL,
  call_points    INTEGER NOT NULL,
  tracked_points INTEGER NOT NULL,
  settled_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, match_id)
);
