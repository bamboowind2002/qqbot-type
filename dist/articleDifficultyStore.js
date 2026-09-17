import crypto from 'node:crypto';

export const ARTICLE_DIFFICULTY_ALGORITHM_VERSION = 'rank-v1';
export const ARTICLE_DIFFICULTY_CANDIDATE_LIMIT = 100;

export function mysqlQuery(connection, sql, values = []) {
  return new Promise((resolve, reject) => connection.query(sql, values, (error, rows) => error ? reject(error) : resolve(rows)));
}

function isMissingDifficultySchema(error) {
  return error?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_BAD_FIELD_ERROR';
}

export function randomKey() { return crypto.randomBytes(8); }

export async function getActiveDifficultyGeneration(connection) {
  try {
    const rows = await mysqlQuery(connection, `
      select g.id, g.algorithm_version, g.block_size, g.status, g.article_count,
             g.processed_articles, g.total_block_count, g.valid_record_count,
             g.invalid_record_count, g.created_at, g.completed_at, g.published_at
        from article_difficulty_state s
        join article_difficulty_generations g on g.id = s.active_generation_id
       where s.singleton_id = 1 and g.status = 'complete'
       limit 1`);
    return rows[0] || null;
  } catch (error) {
    if (isMissingDifficultySchema(error)) return null;
    throw error;
  }
}

async function wrappedQuery(connection, sql, values, fallbackSql, fallbackValues) {
  const rows = await mysqlQuery(connection, sql, values);
  const limit = Number(values.at(-1));
  if (!Number.isSafeInteger(limit) || rows.length >= limit) return rows;
  const wrappedValues = [...fallbackValues];
  wrappedValues[wrappedValues.length - 1] = limit - rows.length;
  return [...rows, ...await mysqlQuery(connection, fallbackSql, wrappedValues)];
}

export async function sampleDifficultyRecords(connection, rank, limit = ARTICLE_DIFFICULTY_CANDIDATE_LIMIT, random = randomKey) {
  const active = await getActiveDifficultyGeneration(connection);
  if (!active) return null;
  const generation = active.id;
  const articleLimit = Math.ceil(limit / 2), blockLimit = Math.floor(limit / 2);
  const articlePivot = random(), blockPivot = random();
  const articleRows = await wrappedQuery(connection, `
    select distinct article_key, title
      from article_difficulty_records
     where generation_id = ? and \`rank\` = ? and article_key >= ?
     order by article_key, title limit ?`, [generation, rank, articlePivot, articleLimit], `
    select distinct article_key, title
      from article_difficulty_records
     where generation_id = ? and \`rank\` = ? and article_key < ?
     order by article_key, title limit ?`, [generation, rank, articlePivot, articleLimit]);
  const articleCandidates = [];
  for (const article of articleRows) {
    const pivot = random();
    const rows = await wrappedQuery(connection, `
        select r.title, r.start, r.length, r.score, r.\`rank\`, a.revision
        from article_difficulty_records r
        join article_difficulty_articles a on a.generation_id = r.generation_id and a.title = r.title
       where r.generation_id = ? and r.title = ? and r.\`rank\` = ? and r.block_key >= ?
       order by r.block_key limit ?`, [generation, article.title, rank, pivot, 1], `
        select r.title, r.start, r.length, r.score, r.\`rank\`, a.revision
        from article_difficulty_records r
        join article_difficulty_articles a on a.generation_id = r.generation_id and a.title = r.title
       where r.generation_id = ? and r.title = ? and r.\`rank\` = ? and r.block_key < ?
       order by r.block_key limit ?`, [generation, article.title, rank, pivot, 1]);
    if (rows[0]) articleCandidates.push(rows[0]);
  }
  const blockCandidates = await wrappedQuery(connection, `
    select r.title, r.start, r.length, r.score, r.\`rank\`, a.revision
      from article_difficulty_records r
      join article_difficulty_articles a on a.generation_id = r.generation_id and a.title = r.title
     where r.generation_id = ? and r.\`rank\` = ? and r.block_key >= ?
     order by r.block_key limit ?`, [generation, rank, blockPivot, blockLimit], `
    select r.title, r.start, r.length, r.score, r.\`rank\`, a.revision
      from article_difficulty_records r
      join article_difficulty_articles a on a.generation_id = r.generation_id and a.title = r.title
     where r.generation_id = ? and r.\`rank\` = ? and r.block_key < ?
     order by r.block_key limit ?`, [generation, rank, blockPivot, blockLimit]);
  const unique = new Map([...articleCandidates, ...blockCandidates].map(row => [`${row.title}:${row.start}`, row]));
  return { backend: 'mysql', generationId: generation, records: [...unique.values()] };
}

export async function renameDifficultyRecords(connection, oldTitle, newTitle) {
  try {
    const result = await mysqlQuery(connection, `
      update article_difficulty_articles a
      join article_difficulty_generations g on g.id = a.generation_id
         set a.title = ?
       where a.title = ? and g.status = 'complete'`, [newTitle, oldTitle]);
    return result.affectedRows > 0;
  } catch (error) {
    if (isMissingDifficultySchema(error)) return false;
    throw error;
  }
}
