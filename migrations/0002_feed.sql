-- Real-data feed: raw stats from vlr.gg ingested by the scheduled feed job.
-- Raw rows only; fantasy points are computed by the client's shared scoring
-- module, so a rule change never needs a re-ingest. No real names, ever.

CREATE TABLE feed_events (
  event_id   INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('live', 'replay', 'offseason')),
  starts_on  TEXT,
  ends_on    TEXT,
  status     TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE feed_matches (
  match_id       INTEGER PRIMARY KEY,
  event_id       INTEGER NOT NULL,
  stage          TEXT,
  series         TEXT,
  best_of        INTEGER,
  starts_at      INTEGER,
  est_end_at     INTEGER,
  status         TEXT NOT NULL CHECK (status IN ('upcoming', 'live', 'final')),
  -- 0 none, 1 pending, 2 partial, 3 complete, 4 settled. Monotonic: a worse
  -- payload never overwrites better stored data.
  stats_rank     INTEGER NOT NULL DEFAULT 0,
  team1_id       INTEGER,
  team2_id       INTEGER,
  team1_name     TEXT,
  team2_name     TEXT,
  team1_tag      TEXT,
  team2_tag      TEXT,
  score1         INTEGER,
  score2         INTEGER,
  winner         INTEGER,
  forfeit        INTEGER NOT NULL DEFAULT 0,
  round_id       TEXT,
  patch          TEXT,
  content_hash   TEXT,
  first_final_at INTEGER,
  ingested_at    INTEGER,
  settle_passes  INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX feed_matches_event ON feed_matches(event_id, starts_at);
CREATE INDEX feed_matches_round ON feed_matches(round_id);

CREATE TABLE feed_maps (
  game_id    INTEGER PRIMARY KEY,
  match_id   INTEGER NOT NULL,
  map_no     INTEGER NOT NULL,
  map_name   TEXT NOT NULL,
  picked_by  INTEGER,
  score1     INTEGER NOT NULL,
  score2     INTEGER NOT NULL,
  t1_atk     INTEGER,
  t1_def     INTEGER,
  t2_atk     INTEGER,
  t2_def     INTEGER,
  duration_s INTEGER,
  UNIQUE (match_id, map_no)
);

CREATE TABLE feed_player_maps (
  game_id  INTEGER NOT NULL,
  vlr_id   INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  side     INTEGER NOT NULL,
  team_tag TEXT,
  agent    TEXT,
  r2       REAL,
  acs      INTEGER,
  k        INTEGER,
  d        INTEGER,
  a        INTEGER,
  kast     INTEGER,
  adr      INTEGER,
  hs       INTEGER,
  fk       INTEGER,
  fd       INTEGER,
  mk2 INTEGER, mk3 INTEGER, mk4 INTEGER, mk5 INTEGER,
  cl1 INTEGER, cl2 INTEGER, cl3 INTEGER, cl4 INTEGER, cl5 INTEGER,
  sides    TEXT,
  PRIMARY KEY (game_id, vlr_id)
) WITHOUT ROWID;
CREATE INDEX feed_pm_player ON feed_player_maps(vlr_id, match_id);

CREATE TABLE feed_players (
  vlr_id       INTEGER PRIMARY KEY,
  handle       TEXT NOT NULL,
  country      TEXT,
  team_id      INTEGER,
  team_tag     TEXT,
  role_hint    TEXT,
  card_id      TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  contract_end INTEGER,
  first_seen_at INTEGER,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX feed_players_updated ON feed_players(updated_at);

CREATE TABLE feed_teams (
  team_id      INTEGER PRIMARY KEY,
  name         TEXT,
  tag          TEXT,
  region       TEXT,
  partner_2027 INTEGER,
  updated_at   INTEGER
);

CREATE TABLE feed_transfers (
  txn_key  TEXT PRIMARY KEY,
  day      TEXT NOT NULL,
  vlr_id   INTEGER NOT NULL,
  handle   TEXT,
  country  TEXT,
  moves    TEXT NOT NULL,
  seen_at  INTEGER NOT NULL
);
CREATE INDEX feed_transfers_day ON feed_transfers(day);

CREATE TABLE feed_values (
  vlr_id INTEGER NOT NULL,
  day    TEXT NOT NULL,
  value  INTEGER NOT NULL,
  form   REAL,
  reason TEXT,
  PRIMARY KEY (vlr_id, day)
) WITHOUT ROWID;

CREATE TABLE feed_sources (
  source          TEXT PRIMARY KEY,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  last_error      TEXT,
  last_alerted_at INTEGER
);

CREATE TABLE feed_runs (
  run_id       TEXT PRIMARY KEY,
  mode         TEXT,
  started_at   INTEGER,
  finished_at  INTEGER,
  ok           INTEGER,
  vlr_requests INTEGER,
  notes        TEXT
);
