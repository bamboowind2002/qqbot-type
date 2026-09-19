CREATE TABLE IF NOT EXISTS `article_categories` (
  `category` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `difficulty_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `article_category_members` (
  `category` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`category`, `title`),
  KEY `idx_article_category_members_title` (`title`, `category`),
  CONSTRAINT `fk_article_category_member_category`
    FOREIGN KEY (`category`) REFERENCES `article_categories` (`category`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_article_category_member_article`
    FOREIGN KEY (`title`) REFERENCES `article_catalog` (`title`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

ALTER TABLE `article_catalog`
  ADD KEY `idx_article_catalog_length_title` (`char_count`, `title`);

CREATE TABLE IF NOT EXISTS `article_catalog_state` (
  `singleton_id` tinyint unsigned NOT NULL,
  `revision` bigint unsigned NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`singleton_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT IGNORE INTO `article_catalog_state` (`singleton_id`, `revision`) VALUES (1, 1);
