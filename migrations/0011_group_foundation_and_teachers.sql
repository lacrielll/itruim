PRAGMA foreign_keys = ON;

CREATE TABLE course_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  course_run_id TEXT NOT NULL REFERENCES course_runs(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('lecture', 'practice')),
  join_code TEXT NOT NULL UNIQUE,
  join_requests_enabled INTEGER NOT NULL DEFAULT 1 CHECK (join_requests_enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(course_run_id, name)
);

CREATE INDEX groups_course_run_idx ON groups(course_run_id, kind, name);

CREATE TABLE group_memberships (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('admin', 'teacher')),
  created_by_id TEXT,
  UNIQUE(student_id, group_id)
);

CREATE INDEX group_memberships_group_idx ON group_memberships(group_id, student_id);

CREATE TABLE group_membership_requests (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by_kind TEXT CHECK (resolved_by_kind IS NULL OR resolved_by_kind IN ('admin', 'teacher')),
  resolved_by_id TEXT,
  CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolved_by_kind IS NULL)
    OR
    (status <> 'pending' AND resolved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX membership_requests_one_pending_idx
  ON group_membership_requests(student_id, group_id)
  WHERE status = 'pending';
CREATE INDEX membership_requests_group_status_idx
  ON group_membership_requests(group_id, status, created_at);
CREATE INDEX membership_requests_student_idx
  ON group_membership_requests(student_id, created_at DESC);

CREATE TABLE teachers (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE teacher_sessions (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK (idle_expires_at > created_at)
);

CREATE INDEX teacher_sessions_teacher_idx ON teacher_sessions(teacher_id, expires_at);

CREATE TABLE teacher_group_access (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  created_by_admin_session_id TEXT REFERENCES admin_sessions(id) ON DELETE SET NULL,
  UNIQUE(teacher_id, group_id)
);

CREATE INDEX teacher_group_access_group_idx ON teacher_group_access(group_id, teacher_id);

