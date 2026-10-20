-- OpVAL roster guesses (apps/call/worker/transferBets.js). `legs` is the JSON list of joins and
-- leaves the guess makes. The stake leaves the wallet as `transfer-bet:<id>`; the payout arrives
-- as `transfer-pay:<id>` when the roster lock settles it.
CREATE TABLE transfer_bets (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team       TEXT NOT NULL,
  legs       TEXT NOT NULL,
  stake      INTEGER NOT NULL CHECK(stake > 0),
  placed_at  INTEGER NOT NULL,
  deadline   INTEGER NOT NULL,
  hits       INTEGER,
  payout     INTEGER,
  settled_at INTEGER
);
CREATE INDEX transfer_bets_user ON transfer_bets(user_id, placed_at);
CREATE INDEX transfer_bets_open ON transfer_bets(settled_at, deadline);
