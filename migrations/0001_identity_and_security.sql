PRAGMA foreign_keys = ON;

CREATE TABLE students (
  id TEXT PRIMARY KEY,
  student_code TEXT NOT NULL UNIQUE,
  fio_display TEXT NOT NULL,
  fio_normalized TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK (idle_expires_at > created_at)
);

CREATE TABLE student_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK (idle_expires_at > created_at)
);

CREATE INDEX student_sessions_student_idx ON student_sessions(student_id, expires_at);

CREATE TABLE idempotency_records (
  scope TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (scope, actor_id, key_hash)
);

CREATE INDEX idempotency_expiry_idx ON idempotency_records(expires_at);

CREATE TABLE rate_limit_buckets (
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  blocked_until INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, key_hash, window_started_at)
);

CREATE INDEX rate_limit_cleanup_idx ON rate_limit_buckets(updated_at);

