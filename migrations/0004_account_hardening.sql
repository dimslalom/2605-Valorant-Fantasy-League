-- Optional email (for password reset), reset tokens, request counters for rate limiting,
-- and a version on each cloud save so two devices cannot silently overwrite each other.

ALTER TABLE users ADD COLUMN email TEXT;                    -- lowercase, NULL when not given
CREATE UNIQUE INDEX users_email ON users(email);            -- NULLs do not collide

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  key      TEXT PRIMARY KEY,
  n        INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

ALTER TABLE saves ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
