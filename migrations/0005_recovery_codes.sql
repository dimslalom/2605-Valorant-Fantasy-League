-- Email sending needs a paid plan, so password recovery uses a one-time recovery code instead.
-- Drops the email pieces from 0004 (never used in production).

DROP TABLE password_resets;
DROP INDEX users_email;
ALTER TABLE users DROP COLUMN email;
ALTER TABLE users ADD COLUMN recovery_hash TEXT;   -- SHA-256 of the recovery code
