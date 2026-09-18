CREATE TABLE student_notification_preferences (
  student_id TEXT PRIMARY KEY REFERENCES students(id) ON DELETE RESTRICT,
  email TEXT,
  telegram_chat_id TEXT,
  email_enabled INTEGER NOT NULL DEFAULT 1 CHECK(email_enabled IN (0,1)),
  telegram_enabled INTEGER NOT NULL DEFAULT 0 CHECK(telegram_enabled IN (0,1)),
  updated_at INTEGER NOT NULL,
  CHECK(email IS NULL OR length(email) BETWEEN 3 AND 320),
  CHECK(telegram_chat_id IS NULL OR length(telegram_chat_id) BETWEEN 1 AND 32)
);
