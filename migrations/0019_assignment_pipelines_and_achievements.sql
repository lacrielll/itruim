ALTER TABLE assignment_versions ADD COLUMN grading_pipeline_json TEXT NOT NULL
  DEFAULT '{"version":"v1","stages":[{"id":"contracts","kind":"contracts","failure_policy":"stop_on_critical"},{"id":"tests","kind":"tests","failure_policy":"stop_on_critical"},{"id":"llm","kind":"llm","failure_policy":"teacher_review"}]}'
  CHECK (json_valid(grading_pipeline_json));

ALTER TABLE assignment_versions ADD COLUMN llm_pipeline_json TEXT NOT NULL
  DEFAULT '{"version":"v1","enabled":true,"preset":"one_clarification","max_rounds":1,"max_questions_per_round":1,"answer_deadline_seconds":86400,"final_decision":"teacher"}'
  CHECK (json_valid(llm_pipeline_json));

ALTER TABLE assignment_versions ADD COLUMN achievement_definitions_json TEXT NOT NULL
  DEFAULT '[]' CHECK (json_valid(achievement_definitions_json));

CREATE TABLE assignment_achievement_nominations (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  achievement_id TEXT NOT NULL,
  source TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL CHECK (json_valid(evidence_ids_json)),
  status TEXT NOT NULL CHECK (status IN ('accepted','pending_teacher','rejected')),
  created_at INTEGER NOT NULL,
  UNIQUE(submission_id,achievement_id,source,reason_code)
);

CREATE INDEX assignment_achievement_nominations_submission_idx
  ON assignment_achievement_nominations(submission_id,created_at);

CREATE TABLE assignment_achievement_awards (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  assignment_version_id TEXT NOT NULL REFERENCES assignment_versions(id) ON DELETE RESTRICT,
  course_run_id TEXT NOT NULL REFERENCES course_runs(id) ON DELETE RESTRICT,
  achievement_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  definition_snapshot_json TEXT NOT NULL CHECK (json_valid(definition_snapshot_json)),
  evidence_ids_json TEXT NOT NULL CHECK (json_valid(evidence_ids_json)),
  source TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  awarded_at INTEGER NOT NULL
);

CREATE INDEX assignment_achievement_awards_student_idx
  ON assignment_achievement_awards(student_id,awarded_at DESC);
CREATE INDEX assignment_achievement_awards_submission_idx
  ON assignment_achievement_awards(submission_id,awarded_at);

ALTER TABLE llm_review_sessions ADD COLUMN state_json TEXT NOT NULL DEFAULT '{"steps":[]}' CHECK (json_valid(state_json));
ALTER TABLE llm_review_sessions ADD COLUMN worker_id TEXT REFERENCES grader_workers(id) ON DELETE RESTRICT;
ALTER TABLE llm_review_sessions ADD COLUMN lease_token_hash TEXT;
ALTER TABLE llm_review_sessions ADD COLUMN lease_expires_at INTEGER;

CREATE TABLE llm_review_steps (
  id TEXT PRIMARY KEY,
  review_session_id TEXT NOT NULL REFERENCES llm_review_sessions(id) ON DELETE RESTRICT,
  step_number INTEGER NOT NULL CHECK (step_number >= 0),
  stage TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(review_session_id,step_number)
);

CREATE INDEX llm_review_steps_session_idx ON llm_review_steps(review_session_id,step_number);
