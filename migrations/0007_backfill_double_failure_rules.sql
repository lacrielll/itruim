INSERT INTO double_failure_rules(
  id,
  quiz_version_id,
  title,
  description,
  emoji,
  theme,
  accent_color,
  created_at
)
SELECT
  v.id,
  v.id,
  'Попытки исчерпаны',
  'Обе попытки завершены ниже порога успеха.',
  '🫠',
  'danger',
  '#b53939',
  coalesce(v.published_at, v.created_at)
FROM quiz_versions v
WHERE v.failure_barrier_enabled = 1
  AND NOT EXISTS(
    SELECT 1
    FROM double_failure_rules dfr
    WHERE dfr.quiz_version_id = v.id
  );
