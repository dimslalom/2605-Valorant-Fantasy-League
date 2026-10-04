-- OpVAL bingo: one card per player per slate day (UTC, YYYY-MM-DD).
-- cells is a JSON array of { square, matchId }, row-major. version guards two devices overwriting each other.

CREATE TABLE bingo_cards (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  cells      TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
