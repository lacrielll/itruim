PRAGMA foreign_keys = ON;

CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE assignment_versions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED')),
  specification TEXT NOT NULL DEFAULT '',
  starter_repository_url TEXT,
  starter_commit_sha TEXT,
  grader_contract_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(grader_contract_json)),
  runtime_profile TEXT NOT NULL DEFAULT 'python-cpu',
  dependency_policy_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(dependency_policy_json)),
  resource_policy_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(resource_policy_json)),
  rubric TEXT NOT NULL DEFAULT '',
  grader_repository TEXT,
  grader_commit_sha TEXT,
  grader_path TEXT,
  grader_entrypoint TEXT,
  private_grader_config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(private_grader_config_json)),
  review_focus TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  UNIQUE(assignment_id, version_number)
);

CREATE UNIQUE INDEX assignment_versions_one_draft_idx
  ON assignment_versions(assignment_id) WHERE status='DRAFT';
CREATE INDEX assignment_versions_assignment_idx
  ON assignment_versions(assignment_id, status, version_number DESC);

CREATE TABLE assignment_publications (
  id TEXT PRIMARY KEY,
  assignment_version_id TEXT NOT NULL REFERENCES assignment_versions(id) ON DELETE RESTRICT,
  course_run_id TEXT NOT NULL REFERENCES course_runs(id) ON DELETE RESTRICT,
  target_all_course_run INTEGER NOT NULL DEFAULT 0 CHECK (target_all_course_run IN (0, 1)),
  opens_at INTEGER,
  due_at INTEGER,
  submission_cooldown_seconds INTEGER NOT NULL DEFAULT 0 CHECK (submission_cooldown_seconds BETWEEN 0 AND 2592000),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (opens_at IS NULL OR due_at IS NULL OR opens_at < due_at),
  UNIQUE(assignment_version_id, course_run_id)
);

CREATE INDEX assignment_publications_course_idx
  ON assignment_publications(course_run_id, is_active, opens_at, due_at);

CREATE TABLE assignment_publication_groups (
  publication_id TEXT NOT NULL REFERENCES assignment_publications(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  PRIMARY KEY(publication_id, group_id)
);

CREATE INDEX assignment_publication_groups_group_idx
  ON assignment_publication_groups(group_id, publication_id);

CREATE TABLE submission_cooldown_overrides (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  assignment_publication_id TEXT NOT NULL REFERENCES assignment_publications(id) ON DELETE RESTRICT,
  waived_until INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('admin', 'teacher')),
  created_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX submission_cooldown_overrides_lookup_idx
  ON submission_cooldown_overrides(student_id, assignment_publication_id, waived_until DESC);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  assignment_version_id TEXT NOT NULL REFERENCES assignment_versions(id) ON DELETE RESTRICT,
  assignment_publication_id TEXT NOT NULL REFERENCES assignment_publications(id) ON DELETE RESTRICT,
  repo_url TEXT NOT NULL,
  repo_identity TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  client_request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'blocked_duplicate_repo','rejected_duplicate_repo','queued','grading','awaiting_answers',
    'awaiting_clarification','awaiting_teacher_review','manual_defense','finalized'
  )),
  submitted_at INTEGER NOT NULL,
  duplicate_of_submission_id TEXT REFERENCES submissions(id) ON DELETE RESTRICT,
  UNIQUE(assignment_publication_id, student_id, attempt_number),
  UNIQUE(student_id, assignment_publication_id, client_request_id)
);

CREATE INDEX submissions_cooldown_idx
  ON submissions(student_id, assignment_publication_id, submitted_at DESC);
CREATE INDEX submissions_repo_identity_idx
  ON submissions(assignment_version_id, repo_identity, submitted_at);
CREATE INDEX submissions_group_idx ON submissions(group_id, submitted_at DESC);

CREATE TABLE assignment_repository_claims (
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  repo_identity TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  first_submission_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY(assignment_id, repo_identity)
);

CREATE TABLE grader_workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE grading_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','infra_failed','cancelled')),
  worker_id TEXT REFERENCES grader_workers(id) ON DELETE RESTRICT,
  lease_token_hash TEXT,
  lease_expires_at INTEGER,
  heartbeat_at INTEGER,
  claim_attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  infra_error_code TEXT,
  CHECK (
    (status='running' AND worker_id IS NOT NULL AND lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR status<>'running'
  )
);

CREATE INDEX grading_jobs_queue_idx ON grading_jobs(status, id);
CREATE INDEX grading_jobs_lease_idx ON grading_jobs(status, lease_expires_at);

CREATE TABLE grading_results (
  id TEXT PRIMARY KEY,
  grading_job_id INTEGER NOT NULL UNIQUE REFERENCES grading_jobs(id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  outcome TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  received_at INTEGER NOT NULL
);

CREATE TABLE submission_review_actions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('allow_duplicate_grading','reject_duplicate','requeue_infra_failure')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('admin','teacher')),
  actor_id TEXT NOT NULL,
  comment TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX submission_review_actions_submission_idx
  ON submission_review_actions(submission_id, created_at);
