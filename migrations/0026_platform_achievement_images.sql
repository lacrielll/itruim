ALTER TABLE course_achievements
ADD COLUMN image_key TEXT REFERENCES media_objects(key) ON DELETE SET NULL;

CREATE INDEX course_achievements_image_idx ON course_achievements(image_key);
