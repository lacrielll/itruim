CREATE TABLE assignment_student_holds (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  source_submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('teacher','admin')),
  created_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  released_at INTEGER,
  released_by_kind TEXT CHECK (released_by_kind IS NULL OR released_by_kind IN ('teacher','admin')),
  released_by_id TEXT,
  release_reason TEXT
);

CREATE UNIQUE INDEX assignment_student_holds_active_idx
  ON assignment_student_holds(assignment_id,student_id) WHERE released_at IS NULL;

CREATE TABLE submission_teacher_decisions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('approve','override_score','manual_defense','reject','finalize_manual_defense')),
  score_json TEXT CHECK (score_json IS NULL OR json_valid(score_json)),
  comment TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('teacher','admin')),
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX submission_teacher_decisions_submission_idx
  ON submission_teacher_decisions(submission_id,created_at);
