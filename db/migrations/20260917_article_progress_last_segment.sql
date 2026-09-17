ALTER TABLE `article_progress`
  ADD COLUMN `last_start` bigint unsigned DEFAULT NULL AFTER `position`,
  ADD COLUMN `last_end` bigint unsigned DEFAULT NULL AFTER `last_start`,
  ADD COLUMN `last_length` int unsigned DEFAULT NULL AFTER `last_end`;
