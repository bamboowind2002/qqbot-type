-- Convert ordered progress from "end of last segment" to "start of current segment".
-- Rows with a recorded last_start came from the previous format. Rows without
-- segment metadata are retained as-is because they may be manual seeks.
UPDATE `article_progress`
SET `position` = `last_start`
WHERE `last_start` IS NOT NULL;

ALTER TABLE `article_progress`
  MODIFY COLUMN `position` bigint unsigned DEFAULT NULL,
  DROP COLUMN `last_start`,
  DROP COLUMN `last_end`,
  DROP COLUMN `last_length`;
