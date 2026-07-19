-- Daily-challenge leaderboard. One row per anonymous client per day; the
-- UNIQUE constraint is the server-side once-per-day gate (INSERT OR IGNORE).
CREATE TABLE IF NOT EXISTS daily_scores (
  date TEXT NOT NULL,        -- "YYYY-M-D", matches the client dateKey()/todaySeed key
  client_id TEXT NOT NULL,   -- locally-minted uuid, no accounts
  squad_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(date, client_id)
);
CREATE INDEX IF NOT EXISTS idx_daily_date_score ON daily_scores(date, score DESC);
CREATE INDEX IF NOT EXISTS idx_daily_client ON daily_scores(client_id);
