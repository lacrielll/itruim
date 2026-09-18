CREATE TABLE course_achievements (
  id TEXT PRIMARY KEY,
  course_run_id TEXT NOT NULL REFERENCES course_runs(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '✦',
  accent_color TEXT NOT NULL DEFAULT '#38BDF8',
  created_by_teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  UNIQUE(course_run_id, slug)
);

CREATE TABLE course_achievement_awards (
  id TEXT PRIMARY KEY,
  achievement_id TEXT NOT NULL REFERENCES course_achievements(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  awarded_by_teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  awarded_at INTEGER NOT NULL,
  UNIQUE(achievement_id, student_id)
);

CREATE INDEX course_achievement_awards_student_idx ON course_achievement_awards(student_id, awarded_at DESC);
