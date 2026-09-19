ALTER TABLE `article_catalog`
  ADD COLUMN `index_status` varchar(20) NOT NULL DEFAULT 'pending' AFTER `map_status`,
  ADD COLUMN `index_key` char(64) DEFAULT NULL AFTER `index_status`,
  ADD COLUMN `index_byte_count` bigint unsigned DEFAULT NULL AFTER `index_key`,
  ADD COLUMN `index_stride` int unsigned DEFAULT NULL AFTER `index_byte_count`,
  ADD COLUMN `index_updated_at` timestamp NULL DEFAULT NULL AFTER `index_stride`,
  ADD COLUMN `index_error` text DEFAULT NULL AFTER `index_updated_at`,
  ADD KEY `idx_article_catalog_index_status_length` (`index_status`, `char_count`, `title`);
