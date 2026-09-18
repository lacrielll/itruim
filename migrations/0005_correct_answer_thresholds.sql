PRAGMA foreign_keys = ON;

-- Percent thresholds are retained as legacy storage columns so historical
-- databases migrate without rebuilding tables. New writes mirror the integer
-- correct-answer threshold into those columns; business logic uses only the
-- new columns below.
ALTER TABLE quiz_versions ADD COLUMN success_barrier_correct_answers INTEGER NOT NULL DEFAULT 1 CHECK (success_barrier_correct_answers > 0);
ALTER TABLE achievement_rules ADD COLUMN min_correct_answers INTEGER NOT NULL DEFAULT 0 CHECK (min_correct_answers >= 0);
ALTER TABLE quiz_attempts ADD COLUMN correct_answers INTEGER CHECK (correct_answers IS NULL OR correct_answers >= 0);

UPDATE quiz_versions
SET success_barrier_correct_answers = CASE
  WHEN (SELECT count(*) FROM questions q WHERE q.quiz_version_id=quiz_versions.id) < 2 THEN 1
  ELSE min(
    (SELECT count(*)-1 FROM questions q WHERE q.quiz_version_id=quiz_versions.id),
    max(1, CAST((failure_barrier_threshold_bp * (SELECT count(*) FROM questions q WHERE q.quiz_version_id=quiz_versions.id) + 9999) / 10000 AS INTEGER))
  )
END;

UPDATE achievement_rules
SET min_correct_answers = CAST((min_percent_bp * (SELECT count(*) FROM questions q WHERE q.quiz_version_id=achievement_rules.quiz_version_id) + 9999) / 10000 AS INTEGER);

UPDATE quiz_attempts
SET correct_answers = (
  SELECT count(*) FROM attempt_answers aa
  WHERE aa.attempt_id=quiz_attempts.id AND aa.is_correct=1
)
WHERE status IN ('SUBMITTED','EXPIRED');

CREATE INDEX achievement_rules_correct_threshold_idx ON achievement_rules(quiz_version_id, min_correct_answers DESC);
CREATE INDEX attempts_correct_answers_idx ON quiz_attempts(quiz_id, correct_answers);
