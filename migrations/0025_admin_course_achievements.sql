PRAGMA foreign_keys = OFF;

CREATE TABLE course_achievements_new (
  id TEXT PRIMARY KEY,
  course_run_id TEXT REFERENCES course_runs(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '✦',
  accent_color TEXT NOT NULL DEFAULT '#38BDF8',
  created_by_kind TEXT NOT NULL CHECK(created_by_kind IN ('admin','teacher')),
  created_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(course_run_id, slug)
);

INSERT INTO course_achievements_new(id,course_run_id,slug,title,description,emoji,accent_color,created_by_kind,created_by_id,created_at)
SELECT id,course_run_id,slug,title,description,emoji,accent_color,'teacher',created_by_teacher_id,created_at FROM course_achievements;

CREATE TABLE course_achievement_awards_new (
  id TEXT PRIMARY KEY,
  achievement_id TEXT NOT NULL REFERENCES course_achievements_new(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  awarded_by_kind TEXT NOT NULL CHECK(awarded_by_kind IN ('admin','teacher')),
  awarded_by_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  awarded_at INTEGER NOT NULL,
  UNIQUE(achievement_id, student_id)
);

INSERT INTO course_achievement_awards_new(id,achievement_id,student_id,awarded_by_kind,awarded_by_id,reason,awarded_at)
SELECT id,achievement_id,student_id,'teacher',awarded_by_teacher_id,reason,awarded_at FROM course_achievement_awards;

DROP TABLE course_achievement_awards;
DROP TABLE course_achievements;
ALTER TABLE course_achievements_new RENAME TO course_achievements;
ALTER TABLE course_achievement_awards_new RENAME TO course_achievement_awards;
CREATE INDEX course_achievement_awards_student_idx ON course_achievement_awards(student_id, awarded_at DESC);

PRAGMA foreign_keys = ON;
