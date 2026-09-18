ALTER TABLE assignment_versions ADD COLUMN rubric_definition_json TEXT NOT NULL
  DEFAULT '{"version":"v1","criteria":[]}' CHECK (json_valid(rubric_definition_json));
