ALTER TABLE numeric_answer_configs
  ADD COLUMN numeric_kind TEXT NOT NULL DEFAULT 'FLOAT'
  CHECK (numeric_kind IN ('INTEGER', 'FLOAT'));

UPDATE numeric_answer_configs
SET numeric_kind = 'INTEGER', absolute_tolerance = 0
WHERE correct_value = CAST(correct_value AS INTEGER)
  AND absolute_tolerance = 0;
