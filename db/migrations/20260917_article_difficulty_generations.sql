-- Apply before deploying the MySQL-backed article difficulty map.
CREATE TABLE IF NOT EXISTS `article_difficulty_generations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `algorithm_version` varchar(64) NOT NULL,
  `block_size` int unsigned NOT NULL,
  `status` varchar(16) NOT NULL,
  `article_count` int unsigned NOT NULL DEFAULT 0,
  `processed_articles` int unsigned NOT NULL DEFAULT 0,
  `total_block_count` bigint unsigned NOT NULL DEFAULT 0,
  `valid_record_count` bigint unsigned NOT NULL DEFAULT 0,
  `invalid_record_count` bigint unsigned NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` datetime(3) NULL,
  `published_at` datetime(3) NULL,
  `error_message` varchar(1000) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_article_difficulty_generation_status` (`status`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `article_difficulty_state` (
  `singleton_id` tinyint unsigned NOT NULL,
  `active_generation_id` bigint unsigned NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`singleton_id`),
  CONSTRAINT `fk_article_difficulty_state_generation`
    FOREIGN KEY (`active_generation_id`) REFERENCES `article_difficulty_generations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `article_difficulty_articles` (
  `generation_id` bigint unsigned NOT NULL,
  `title` varchar(255) NOT NULL,
  `revision` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `total_block_count` int unsigned NOT NULL,
  `valid_record_count` int unsigned NOT NULL,
  `invalid_record_count` int unsigned NOT NULL,
  PRIMARY KEY (`generation_id`, `title`),
  CONSTRAINT `fk_article_difficulty_articles_generation`
    FOREIGN KEY (`generation_id`) REFERENCES `article_difficulty_generations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_article_difficulty_article_counts`
    CHECK (`total_block_count` = `valid_record_count` + `invalid_record_count`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `article_difficulty_records` (
  `generation_id` bigint unsigned NOT NULL,
  `title` varchar(255) NOT NULL,
  `start` int unsigned NOT NULL,
  `length` smallint unsigned NOT NULL,
  `score` double NOT NULL,
  `rank` varchar(8) NOT NULL,
  `article_key` binary(8) NOT NULL,
  `block_key` binary(8) NOT NULL,
  PRIMARY KEY (`generation_id`, `title`, `start`),
  KEY `idx_article_difficulty_block_sample` (`generation_id`, `rank`, `block_key`),
  KEY `idx_article_difficulty_article_sample` (`generation_id`, `rank`, `article_key`, `title`),
  KEY `idx_article_difficulty_article_block_sample` (`generation_id`, `title`, `rank`, `block_key`),
  CONSTRAINT `fk_article_difficulty_record_article`
    FOREIGN KEY (`generation_id`, `title`)
    REFERENCES `article_difficulty_articles` (`generation_id`, `title`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT IGNORE INTO `article_difficulty_state` (`singleton_id`, `active_generation_id`) VALUES (1, NULL);
