-- Each submitted card is final and carries its own odds and submission time.
-- Existing cards were submitted before their week began and keep those terms.
ALTER TABLE weekly_bingo_cards ADD COLUMN locked_at INTEGER;
ALTER TABLE weekly_bingo_cards ADD COLUMN catalog TEXT;
UPDATE weekly_bingo_cards SET locked_at=updated_at,
  catalog=(SELECT catalog FROM weekly_bingo_weeks WHERE week=weekly_bingo_cards.week);
