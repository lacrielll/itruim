PRAGMA foreign_keys = ON;

CREATE TABLE group_registration_invites (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX group_registration_invites_group_idx
  ON group_registration_invites(group_id,is_active,created_at);
