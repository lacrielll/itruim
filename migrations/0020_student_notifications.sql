CREATE TABLE student_notifications (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('clarification','submission_result','achievement','system')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_kind TEXT,
  entity_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);

CREATE INDEX student_notifications_inbox_idx
  ON student_notifications(student_id, read_at, created_at DESC);

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES student_notifications(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK(channel IN ('webhook')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_expires_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  UNIQUE(notification_id, channel)
);

CREATE INDEX notification_outbox_delivery_idx
  ON notification_outbox(status, next_attempt_at, lease_expires_at);
