CREATE TABLE telegram_link_tokens (
  token_hash TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX telegram_link_tokens_expiry_idx ON telegram_link_tokens(expires_at,consumed_at);
