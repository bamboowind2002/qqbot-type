-- Add composable rank summaries to the 100-character difficulty map.
-- Deploy this migration before code using rank-v2-summary, then rebuild the map.
ALTER TABLE `article_difficulty_records`
  ADD COLUMN `hard_score` double NULL AFTER `block_key`,
  ADD COLUMN `water_delta` double NULL AFTER `hard_score`,
  ADD COLUMN `hard_prefix` double NULL AFTER `water_delta`,
  ADD COLUMN `water_prefix` double NULL AFTER `hard_prefix`,
  ADD COLUMN `valid_prefix` int unsigned NULL AFTER `water_prefix`;
