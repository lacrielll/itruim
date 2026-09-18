CREATE TABLE double_failure_rules (
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

ALTER TABLE quiz_attempts ADD COLUMN double_failure_rule_id TEXT REFERENCES double_failure_rules(id) ON DELETE RESTRICT;

CREATE INDEX idx_double_failure_rules_image ON double_failure_rules(image_key);
CREATE INDEX idx_attempts_double_failure ON quiz_attempts(double_failure_rule_id);
