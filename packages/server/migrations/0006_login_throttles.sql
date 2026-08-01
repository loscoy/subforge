CREATE TABLE IF NOT EXISTS login_throttles (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  lockedUntil INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
