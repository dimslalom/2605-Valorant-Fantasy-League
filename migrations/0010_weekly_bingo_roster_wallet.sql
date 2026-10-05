-- New weekly game; the legacy daily bingo_cards table remains untouched.
CREATE TABLE roster_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  UNIQUE(source, content_hash)
);
CREATE TABLE roster_snapshot_rows (
  snapshot_id INTEGER NOT NULL REFERENCES roster_snapshots(id),
  identity_key TEXT NOT NULL,
  player TEXT NOT NULL,
  team TEXT NOT NULL,
  league TEXT NOT NULL,
  contract_end TEXT,
  PRIMARY KEY(snapshot_id,identity_key)
);
CREATE TABLE roster_contracts (
  identity_key TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  team TEXT NOT NULL,
  league TEXT,
  contract_end TEXT,
  source_url TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE roster_candidates (
  identity_key TEXT PRIMARY KEY,
  change_type TEXT NOT NULL,
  old_row TEXT,
  new_row TEXT,
  first_seen_at INTEGER NOT NULL,
  passes INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE roster_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_key TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK(change_type IN ('roster_add','roster_depart','contract_change')),
  player TEXT NOT NULL,
  team TEXT,
  old_end TEXT,
  new_end TEXT,
  source_url TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  confirmed_at INTEGER NOT NULL,
  UNIQUE(identity_key, change_type, first_seen_at)
);
CREATE INDEX roster_events_week ON roster_events(first_seen_at);
CREATE TABLE roster_unresolved (
  identity_key TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  raw_row TEXT NOT NULL,
  observed_at INTEGER NOT NULL
);
ALTER TABLE feed_transfers ADD COLUMN source_url TEXT;
ALTER TABLE feed_matches ADD COLUMN first_seen_at INTEGER;
CREATE INDEX feed_matches_week ON feed_matches(starts_at,first_seen_at);
CREATE INDEX feed_pm_match ON feed_player_maps(match_id,vlr_id);
CREATE TABLE weekly_bingo_weeks (
  week TEXT PRIMARY KEY,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  schedule TEXT NOT NULL DEFAULT '[]',
  catalog TEXT NOT NULL DEFAULT '{}',
  payout_rate REAL NOT NULL DEFAULT 1,
  paid_enabled INTEGER NOT NULL DEFAULT 0,
  locked_at INTEGER,
  settled_at INTEGER
);
CREATE TABLE weekly_bingo_cards (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week TEXT NOT NULL REFERENCES weekly_bingo_weeks(week),
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 5),
  cells TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,week,slot)
);
CREATE INDEX weekly_bingo_cards_week ON weekly_bingo_cards(week);
CREATE TABLE weekly_bingo_results (
  user_id INTEGER NOT NULL,
  week TEXT NOT NULL,
  slot INTEGER NOT NULL,
  points INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  detail TEXT NOT NULL,
  settled_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,week,slot)
);
CREATE TABLE wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL CHECK(balance >= 0),
  opened_at INTEGER NOT NULL
);
CREATE TABLE wallet_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_key TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id,entry_key)
);
CREATE INDEX wallet_entries_user ON wallet_entries(user_id,id);
CREATE TABLE roster_source_checks (
  observed_at INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES roster_snapshots(id)
);
CREATE INDEX roster_source_checks_snapshot ON roster_source_checks(snapshot_id,observed_at);
CREATE TABLE bingo_calibration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at INTEGER NOT NULL,
  training_weeks INTEGER NOT NULL,
  holdout_week TEXT,
  training_mean REAL,
  holdout_mean REAL,
  payout_rate REAL,
  passed INTEGER NOT NULL,
  notes TEXT
);
CREATE TABLE bingo_observations (
  week TEXT NOT NULL,
  square TEXT NOT NULL,
  exposure INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  trials INTEGER NOT NULL,
  PRIMARY KEY(week,square,exposure)
);
CREATE INDEX bingo_observations_square ON bingo_observations(square,exposure);
