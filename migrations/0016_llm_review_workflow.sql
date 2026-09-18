ALTER TABLE submissions ADD COLUMN contact_email TEXT;
ALTER TABLE submissions ADD COLUMN contact_email_hash TEXT;

CREATE TABLE llm_review_sessions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('pending','initial_review','awaiting_answer_1','reviewing_answer_1','awaiting_answer_2','reviewing_answer_2','completed','expired','manual_review')),
  rubric_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  question_count INTEGER NOT NULL DEFAULT 0 CHECK (question_count BETWEEN 0 AND 2),
  input_hash TEXT,
  final_result_json TEXT CHECK (final_result_json IS NULL OR json_valid(final_result_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE llm_clarifications (
  id TEXT PRIMARY KEY,
  review_session_id TEXT NOT NULL REFERENCES llm_review_sessions(id) ON DELETE RESTRICT,
  question_number INTEGER NOT NULL CHECK (question_number IN (1,2)),
  question TEXT NOT NULL,
  private_expected_topics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(private_expected_topics_json)),
  asked_at INTEGER NOT NULL,
  answer_deadline_at INTEGER NOT NULL,
  answer TEXT,
  answered_at INTEGER,
  answer_evaluation_json TEXT CHECK (answer_evaluation_json IS NULL OR json_valid(answer_evaluation_json)),
  UNIQUE(review_session_id, question_number),
  CHECK ((answer IS NULL AND answered_at IS NULL) OR (answer IS NOT NULL AND answered_at IS NOT NULL))
);

CREATE INDEX llm_review_sessions_state_idx ON llm_review_sessions(state, updated_at);
CREATE INDEX llm_clarifications_deadline_idx ON llm_clarifications(answer_deadline_at) WHERE answered_at IS NULL;

CREATE TABLE llm_provider_attempts (
  id TEXT PRIMARY KEY,
  review_session_id TEXT NOT NULL REFERENCES llm_review_sessions(id) ON DELETE RESTRICT,
  stage TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  outcome TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL
);
