PRAGMA foreign_keys = ON;

CREATE TABLE quiz_publications (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE RESTRICT,
  quiz_version_id TEXT NOT NULL REFERENCES quiz_versions(id) ON DELETE RESTRICT,
  course_run_id TEXT NOT NULL REFERENCES course_runs(id) ON DELETE RESTRICT,
  target_all_course_run INTEGER NOT NULL DEFAULT 0 CHECK (target_all_course_run IN (0, 1)),
  opens_at INTEGER,
  start_deadline_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (opens_at IS NULL OR start_deadline_at IS NULL OR opens_at < start_deadline_at),
  UNIQUE(quiz_id, course_run_id)
);

CREATE INDEX quiz_publications_version_idx ON quiz_publications(quiz_version_id, is_active);
CREATE INDEX quiz_publications_course_idx ON quiz_publications(course_run_id, is_active);

CREATE TABLE quiz_publication_groups (
  publication_id TEXT NOT NULL REFERENCES quiz_publications(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  PRIMARY KEY(publication_id, group_id)
);

CREATE INDEX quiz_publication_groups_group_idx ON quiz_publication_groups(group_id, publication_id);

ALTER TABLE quiz_attempts ADD COLUMN quiz_publication_id TEXT REFERENCES quiz_publications(id) ON DELETE RESTRICT;
ALTER TABLE quiz_attempts ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT;

CREATE INDEX quiz_attempts_publication_idx ON quiz_attempts(quiz_publication_id, student_id);
CREATE INDEX quiz_attempts_group_idx ON quiz_attempts(group_id, student_id);

