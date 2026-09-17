ALTER TABLE `article_user_settings`
  ADD COLUMN `last_mode` varchar(20) DEFAULT NULL AFTER `segment_length`,
  ADD COLUMN `last_title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL AFTER `last_mode`,
  ADD COLUMN `last_difficulty` varchar(20) DEFAULT NULL AFTER `last_title`,
  ADD COLUMN `last_range_start` bigint unsigned DEFAULT NULL AFTER `last_difficulty`,
  ADD COLUMN `last_range_end` bigint unsigned DEFAULT NULL AFTER `last_range_start`,
  ADD COLUMN `last_condition` varchar(1000) DEFAULT NULL AFTER `last_range_end`;
