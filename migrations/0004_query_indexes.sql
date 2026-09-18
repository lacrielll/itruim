CREATE INDEX quizzes_deadline_idx ON quizzes(start_deadline_at);
CREATE INDEX quizzes_published_idx ON quizzes(published_version_id);
CREATE INDEX students_code_idx ON students(student_code);
CREATE INDEX attempts_quiz_student_idx ON quiz_attempts(quiz_id, student_id, attempt_no);
CREATE INDEX attempts_finalized_idx ON quiz_attempts(finalized_at, status);

