-- Stop the bot before running this migration. The old application assumes
-- that qqid is unique and is not safe after users begin owning multiple rows.
DELIMITER //

CREATE PROCEDURE migrate_private_word_base_multiple_schemes()
BEGIN
  IF EXISTS (SELECT 1 FROM private_word_base WHERE name IS NULL OR name = '') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'private_word_base contains an empty scheme name';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private_word_base
    GROUP BY name
    HAVING COUNT(*) > 1
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'private_word_base contains duplicate scheme names';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private_word_base AS private_scheme
    INNER JOIN public_word_base AS public_scheme ON public_scheme.name = private_scheme.name
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'public and private scheme names overlap';
  END IF;

  ALTER TABLE private_word_base
    MODIFY name varchar(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL,
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (name),
    ADD KEY idx_private_word_base_qqid (qqid);
END//

CALL migrate_private_word_base_multiple_schemes()//
DROP PROCEDURE migrate_private_word_base_multiple_schemes//

DELIMITER ;
