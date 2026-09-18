PRAGMA foreign_keys = ON;

CREATE TABLE quiz_attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE RESTRICT,
  quiz_version_id TEXT NOT NULL REFERENCES quiz_versions(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  attempt_no INTEGER NOT NULL CHECK (attempt_no IN (1, 2)),
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'SUBMITTED', 'EXPIRED')),
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > started_at),
  submitted_at INTEGER,
  finalized_at INTEGER,
  score INTEGER CHECK (score IS NULL OR score >= 0),
  max_score INTEGER NOT NULL CHECK (max_score > 0),
  percent_bp INTEGER CHECK (percent_bp IS NULL OR percent_bp BETWEEN 0 AND 10000),
  achievement_rule_id TEXT REFERENCES achievement_rules(id) ON DELETE RESTRICT,
  question_order_json TEXT NOT NULL CHECK (json_valid(question_order_json)),
  option_order_json TEXT NOT NULL CHECK (json_valid(option_order_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (quiz_id, student_id, attempt_no),
  CHECK (
    (status = 'STARTED' AND finalized_at IS NULL AND score IS NULL AND percent_bp IS NULL)
    OR
    (status IN ('SUBMITTED', 'EXPIRED') AND finalized_at IS NOT NULL AND score IS NOT NULL AND percent_bp IS NOT NULL)
  ),
  CHECK (
    (status = 'SUBMITTED' AND submitted_at IS NOT NULL)
    OR
    (status != 'SUBMITTED' AND submitted_at IS NULL)
  )
);

CREATE INDEX attempts_student_status_idx ON quiz_attempts(student_id, status);
CREATE INDEX attempts_quiz_status_idx ON quiz_attempts(quiz_id, status);
CREATE INDEX attempts_version_status_idx ON quiz_attempts(quiz_version_id, status);
CREATE INDEX attempts_expiry_idx ON quiz_attempts(status, expires_at);

CREATE TABLE attempt_answers (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES quiz_attempts(id) ON DELETE RESTRICT,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  answer_json TEXT NOT NULL CHECK (json_valid(answer_json)),
  is_correct INTEGER CHECK (is_correct IS NULL OR is_correct IN (0, 1)),
  awarded_score INTEGER CHECK (awarded_score IS NULL OR awarded_score >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX attempt_answers_attempt_idx ON attempt_answers(attempt_id);
CREATE INDEX attempt_answers_question_idx ON attempt_answers(question_id, is_correct);

