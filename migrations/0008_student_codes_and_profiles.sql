UPDATE students
SET student_code = upper(substr(hex(randomblob(16)), 1, 12))
WHERE length(student_code) <> 12;

ALTER TABLE students ADD COLUMN profile_share_token TEXT;
ALTER TABLE students ADD COLUMN profile_is_public INTEGER NOT NULL DEFAULT 0 CHECK (profile_is_public IN (0, 1));

CREATE UNIQUE INDEX students_profile_share_token_unique
  ON students(profile_share_token)
  WHERE profile_share_token IS NOT NULL;

