-- OpVAL accounts: username + password, cookie sessions, and one cloud save per user.
-- Only a salted PBKDF2 hash of the password and a SHA-256 of the session token are stored.

CREATE TABLE users (
  id         INTEGER PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,   -- lowercase, 3-20 of [a-z0-9_]
  pw_hash    TEXT NOT NULL,          -- "<salt hex>:<hash hex>"
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE saves (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state      TEXT NOT NULL,          -- the client's game state, JSON
  updated_at INTEGER NOT NULL
);
