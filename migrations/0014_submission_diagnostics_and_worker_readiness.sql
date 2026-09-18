PRAGMA foreign_keys = ON;

ALTER TABLE assignment_versions ADD COLUMN environment_version TEXT NOT NULL DEFAULT 'cpu-v1';
UPDATE assignment_versions
SET runtime_profile = CASE WHEN lower(runtime_profile) LIKE '%gpu%' THEN 'GPU' ELSE 'CPU' END;

ALTER TABLE submissions ADD COLUMN deterministic_status TEXT
  CHECK (deterministic_status IS NULL OR deterministic_status IN ('passed','failed'));

ALTER TABLE grading_jobs ADD COLUMN current_stage TEXT NOT NULL DEFAULT 'queued'
  CHECK (current_stage IN ('queued','repository','contracts','tests','uploading','completed','infrastructure_retry'));
ALTER TABLE grading_jobs ADD COLUMN public_stage_message TEXT;
ALTER TABLE grading_jobs ADD COLUMN infra_retry_count INTEGER NOT NULL DEFAULT 0 CHECK (infra_retry_count >= 0);
ALTER TABLE grading_jobs ADD COLUMN next_retry_at INTEGER;

ALTER TABLE grader_workers ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '["CPU"]' CHECK (json_valid(capabilities_json));
ALTER TABLE grader_workers ADD COLUMN is_ready INTEGER NOT NULL DEFAULT 0 CHECK (is_ready IN (0,1));
ALTER TABLE grader_workers ADD COLUMN environment_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(environment_json));

ALTER TABLE grading_results ADD COLUMN public_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE grading_results ADD COLUMN public_diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(public_diagnostics_json));
ALTER TABLE grading_results ADD COLUMN private_diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(private_diagnostics_json));
ALTER TABLE grading_results ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(evidence_json));
ALTER TABLE grading_results ADD COLUMN deterministic_gate TEXT NOT NULL DEFAULT 'failed'
  CHECK (deterministic_gate IN ('passed','failed'));
ALTER TABLE grading_results ADD COLUMN llm_eligible INTEGER NOT NULL DEFAULT 0 CHECK (llm_eligible IN (0,1));

CREATE TABLE submission_stage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  grading_job_id INTEGER REFERENCES grading_jobs(id) ON DELETE RESTRICT,
  stage TEXT NOT NULL CHECK (stage IN ('submitted','repository','contracts','tests','llm','teacher_review','finalized','infrastructure')),
  outcome TEXT NOT NULL CHECK (outcome IN ('pending','running','passed','failed','skipped','retrying')),
  public_summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX submission_stage_events_submission_idx
  ON submission_stage_events(submission_id, id);
CREATE INDEX grading_jobs_retry_idx
  ON grading_jobs(status, next_retry_at, id);

INSERT INTO submission_stage_events(submission_id,grading_job_id,stage,outcome,public_summary,created_at)
SELECT sub.id,j.id,'submitted','passed','Отправка принята',sub.submitted_at
FROM submissions sub LEFT JOIN grading_jobs j ON j.submission_id=sub.id;
