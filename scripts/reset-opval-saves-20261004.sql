-- One-time OpVAL account reset: empty collection, two free packs, no progress.
-- Run only after deploying the free-pack code. Passwords and sessions are untouched.
-- Incrementing every existing save version makes stale open tabs receive a 409.
INSERT INTO saves (user_id, state, updated_at, version)
SELECT u.id,
  json_object(
    'v', 1,
    'seed', abs(random() % 1000000000),
    'createdAt', unixepoch(),
    'collection', json('[]'),
    'tracked', json('[]'),
    'credits', 0,
    'streak', 0,
    'packsOpened', 0,
    'freePacks', 2,
    'calls', json('{}'),
    'history', json('[]'),
    'freeSwaps', 3,
    'trackedLog', json('[{"t":0,"tracked":[]}]'),
    'revealed', json('{}')
  ),
  unixepoch(),
  1
FROM users AS u WHERE true
ON CONFLICT(user_id) DO UPDATE SET
  state = excluded.state,
  updated_at = excluded.updated_at,
  version = saves.version + 1;
