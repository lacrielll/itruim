CREATE TABLE submission_policy_acceptances (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  policy_version TEXT NOT NULL,
  policy_text_sha256 TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
);

CREATE TABLE submission_security_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  grading_job_id INTEGER REFERENCES grading_jobs(id) ON DELETE RESTRICT,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  code TEXT NOT NULL,
  stage TEXT NOT NULL,
  source_path TEXT,
  source_line INTEGER,
  private_details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX submission_security_events_submission_idx
  ON submission_security_events(submission_id, created_at);
