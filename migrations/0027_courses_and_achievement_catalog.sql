PRAGMA foreign_keys = ON;

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE course_runs ADD COLUMN course_id TEXT REFERENCES courses(id) ON DELETE RESTRICT;
CREATE INDEX course_runs_course_idx ON course_runs(course_id, created_at DESC);

ALTER TABLE assignments ADD COLUMN course_id TEXT REFERENCES courses(id) ON DELETE RESTRICT;
CREATE INDEX assignments_course_idx ON assignments(course_id, updated_at DESC);

ALTER TABLE course_achievements ADD COLUMN course_id TEXT REFERENCES courses(id) ON DELETE RESTRICT;
ALTER TABLE course_achievements ADD COLUMN unlock_hint TEXT NOT NULL DEFAULT '';
ALTER TABLE course_achievements ADD COLUMN applicability_scope TEXT NOT NULL DEFAULT 'selected_assignments'
  CHECK(applicability_scope IN ('global_course','selected_assignments'));
ALTER TABLE course_achievements ADD COLUMN required_capability TEXT NOT NULL DEFAULT 'any'
  CHECK(required_capability IN ('any','grader','llm'));
ALTER TABLE course_achievements ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'teacher'
  CHECK(source_kind IN ('grader','runtime','llm','pipeline','teacher','platform'));
ALTER TABLE course_achievements ADD COLUMN repeatability TEXT NOT NULL DEFAULT 'once_per_course'
  CHECK(repeatability IN ('once_per_course','once_per_assignment','repeatable'));
ALTER TABLE course_achievements ADD COLUMN definition_json TEXT CHECK(definition_json IS NULL OR json_valid(definition_json));
CREATE INDEX course_achievements_catalog_idx ON course_achievements(course_id, applicability_scope, source_kind, created_at DESC);

CREATE TABLE assignment_achievement_bindings (
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  achievement_id TEXT NOT NULL REFERENCES course_achievements(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(assignment_id, achievement_id)
);

CREATE INDEX assignment_achievement_bindings_achievement_idx
  ON assignment_achievement_bindings(achievement_id, assignment_id);

-- Preserve existing installations. Each legacy run becomes a course initially;
-- administrators can rename it after migration. New writes always require a course.
INSERT INTO courses(id,slug,title,created_at,updated_at)
SELECT id,'course-' || substr(replace(id,'-',''),1,12),name,created_at,updated_at FROM course_runs;

UPDATE course_runs SET course_id=id WHERE course_id IS NULL;
UPDATE assignments SET course_id=(SELECT course_id FROM course_runs ORDER BY created_at LIMIT 1) WHERE course_id IS NULL;
UPDATE course_achievements
SET course_id=coalesce(
  (SELECT course_id FROM course_runs WHERE id=course_achievements.course_run_id),
  (SELECT id FROM courses ORDER BY created_at LIMIT 1)
) WHERE course_id IS NULL;
