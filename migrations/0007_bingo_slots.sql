-- Bingo: more than one card per player per day. A card is now (user, day, slot), slot 1..5.
-- bingo_cards from 0006 never shipped, so it is rebuilt rather than migrated.

DROP TABLE bingo_cards;

CREATE TABLE bingo_cards (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  slot       INTEGER NOT NULL,
  cells      TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day, slot)
);
