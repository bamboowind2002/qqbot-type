CREATE TABLE IF NOT EXISTS `article_catalog` (
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `char_count` bigint unsigned NOT NULL,
  `byte_count` bigint unsigned NOT NULL,
  `content_sha256` char(64) NOT NULL,
  `mapped_sha256` char(64) DEFAULT NULL,
  `map_status` varchar(20) NOT NULL DEFAULT 'pending',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `article_progress` (
  `qqid` varchar(20) NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `position` bigint unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`qqid`, `title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `article_user_settings` (
  `qqid` varchar(20) NOT NULL,
  `current_title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `segment_length` int unsigned NOT NULL DEFAULT 100,
  PRIMARY KEY (`qqid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
