CREATE TABLE retry_success_rules (
  id TEXT PRIMARY KEY,
  quiz_version_id TEXT NOT NULL UNIQUE REFERENCES quiz_versions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_key TEXT REFERENCES media_objects(key) ON DELETE SET NULL,
  emoji TEXT,
  theme TEXT CHECK (theme IS NULL OR theme IN ('default','success','warning','danger','info')),
  accent_color TEXT,
  created_at INTEGER NOT NULL
);

ALTER TABLE quiz_attempts ADD COLUMN retry_success_rule_id TEXT REFERENCES retry_success_rules(id) ON DELETE RESTRICT;

CREATE INDEX idx_retry_success_rules_image ON retry_success_rules(image_key);
CREATE INDEX idx_attempts_retry_success ON quiz_attempts(retry_success_rule_id);

INSERT INTO retry_success_rules(
  id, quiz_version_id, title, description, emoji, theme, accent_color, created_at
)
SELECT
  v.id, v.id, 'Камбэк', 'Порог успеха пройден со второй попытки.', '↗️',
  'success', '#4f7d32', coalesce(v.published_at, v.created_at)
FROM quiz_versions v
WHERE v.failure_barrier_enabled = 1;

