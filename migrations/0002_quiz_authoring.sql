PRAGMA foreign_keys = ON;

CREATE TABLE media_objects (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'READY')),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  sha256 TEXT NOT NULL,
  created_by_admin_session_id TEXT REFERENCES admin_sessions(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  ready_at INTEGER
);

CREATE INDEX media_status_created_idx ON media_objects(status, created_at);

CREATE TABLE quizzes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  published_version_id TEXT,
  opens_at INTEGER,
  start_deadline_at INTEGER,
  availability_revision INTEGER NOT NULL DEFAULT 1 CHECK (availability_revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (opens_at IS NULL OR start_deadline_at IS NULL OR opens_at < start_deadline_at),
  FOREIGN KEY (published_version_id) REFERENCES quiz_versions(id) ON DELETE SET NULL
);

CREATE TABLE quiz_versions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  time_per_question_seconds INTEGER NOT NULL DEFAULT 60 CHECK (time_per_question_seconds BETWEEN 5 AND 3600),
  shuffle_questions INTEGER NOT NULL DEFAULT 0 CHECK (shuffle_questions IN (0, 1)),
  shuffle_options INTEGER NOT NULL DEFAULT 0 CHECK (shuffle_options IN (0, 1)),
  failure_barrier_enabled INTEGER NOT NULL DEFAULT 0 CHECK (failure_barrier_enabled IN (0, 1)),
  failure_barrier_threshold_bp INTEGER NOT NULL DEFAULT 5000 CHECK (failure_barrier_threshold_bp BETWEEN 0 AND 10000),
  show_answer_review_after_submit INTEGER NOT NULL DEFAULT 0 CHECK (show_answer_review_after_submit IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  UNIQUE (quiz_id, version_number)
);

CREATE UNIQUE INDEX quiz_versions_one_draft_idx ON quiz_versions(quiz_id) WHERE status = 'DRAFT';
CREATE INDEX quiz_versions_quiz_status_idx ON quiz_versions(quiz_id, status);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  quiz_version_id TEXT NOT NULL REFERENCES quiz_versions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  type TEXT NOT NULL CHECK (type IN ('SINGLE', 'MULTIPLE', 'NUMERIC', 'SHORT_TEXT')),
  text TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 1 CHECK (points > 0),
  created_at INTEGER NOT NULL,
  UNIQUE (quiz_version_id, position)
);

CREATE INDEX questions_version_idx ON questions(quiz_version_id, position);

CREATE TABLE question_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  UNIQUE (question_id, position)
);

CREATE INDEX question_options_question_idx ON question_options(question_id, position);

CREATE TABLE numeric_answer_configs (
  question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  correct_value REAL NOT NULL,
  absolute_tolerance REAL NOT NULL CHECK (absolute_tolerance >= 0)
);

CREATE TABLE short_answer_variants (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_normalized TEXT NOT NULL,
  UNIQUE (question_id, answer_normalized)
);

CREATE INDEX short_answers_question_idx ON short_answer_variants(question_id);

CREATE TABLE achievement_rules (
  id TEXT PRIMARY KEY,
  quiz_version_id TEXT NOT NULL REFERENCES quiz_versions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  min_percent_bp INTEGER NOT NULL CHECK (min_percent_bp BETWEEN 0 AND 10000),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_key TEXT REFERENCES media_objects(key) ON DELETE SET NULL,
  emoji TEXT,
  theme TEXT CHECK (theme IS NULL OR theme IN ('default', 'success', 'warning', 'danger', 'info')),
  accent_color TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (quiz_version_id, min_percent_bp),
  UNIQUE (quiz_version_id, position)
);

CREATE INDEX achievement_rules_version_idx ON achievement_rules(quiz_version_id, min_percent_bp DESC);

