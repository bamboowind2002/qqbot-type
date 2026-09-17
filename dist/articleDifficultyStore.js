import crypto from 'node:crypto';
import { DIFFICULTY_RANGES, normalizeDifficulty } from './articleDifficulty.js';

export const ARTICLE_DIFFICULTY_ALGORITHM_VERSION = 'rank-v2-summary';
export const ARTICLE_DIFFICULTY_CANDIDATE_LIMIT = 100;
export const ARTICLE_DIFFICULTY_COMPOSED_CANDIDATE_LIMIT = 16;
export const ARTICLE_DIFFICULTY_COMPOSED_SAMPLE_LIMIT = 128;
const ARTICLE_DIFFICULTY_BLOCK_SIZE = 100;

export function mysqlQuery(connection, sql, values = []) {
  return new Promise((resolve, reject) => connection.query(sql, values, (error, rows) => error ? reject(error) : resolve(rows)));
}

function isMissingDifficultySchema(error) {
  return error?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_BAD_FIELD_ERROR';
}

export function randomKey() { return crypto.randomBytes(8); }

export function scoreDifficultySummary(hard, waterDelta) {
  hard = Number(hard); waterDelta = Number(waterDelta);
  if (!Number.isFinite(hard) || !Number.isFinite(waterDelta) || waterDelta < 0) return null;
  return Math.round((hard / (1 + waterDelta)) * 100) / 100;
}

function difficultyDistance(score, rank) {
  const [low, high] = DIFFICULTY_RANGES[normalizeDifficulty(rank)];
  if (score >= low && score < high) return 0;
  return score < low ? low - score : score - high;
}

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
  // article_key and block_key are random per generation. Pick one block from
  // each sampled article in one query instead of issuing an N+1 query loop.
  const articleCandidates = await wrappedQuery(connection, `
    select r.title, r.start, r.length, r.score, r.\`rank\`, a.revision
      from article_difficulty_records r
      join (
        select generation_id, \`rank\`, article_key, title, min(block_key) as block_key
          from article_difficulty_records
         where generation_id = ? and \`rank\` = ? and article_key >= ?
         group by generation_id, \`rank\`, article_key, title
         order by article_key, title limit ?
      ) sampled on sampled.generation_id = r.generation_id and sampled.\`rank\` = r.\`rank\`
        and sampled.article_key = r.article_key and sampled.title = r.title and sampled.block_key = r.block_key
      join article_difficulty_articles a on a.generation_id = r.generation_id and a.title = r.title
    `,
  [generation, rank, articlePivot, articleLimit], `
    select r.title, r.start, r.length, r.score, r.\`rank\`, a.revision
      from article_difficulty_records r
      join (
        select generation_id, \`rank\`, article_key, title, min(block_key) as block_key
          from article_difficulty_records
         where generation_id = ? and \`rank\` = ? and article_key < ?
         group by generation_id, \`rank\`, article_key, title
         order by article_key, title limit ?
      ) sampled on sampled.generation_id = r.generation_id and sampled.\`rank\` = r.\`rank\`
        and sampled.article_key = r.article_key and sampled.title = r.title and sampled.block_key = r.block_key
      join article_difficulty_articles a on a.generation_id = r.generation_id and a.title = r.title
    `,
  [generation, rank, articlePivot, articleLimit]);
  // The caller re-reads and re-ranks every block candidate, so a revision
  // lookup here is redundant and turns random index reads into costly joins.
  const blockCandidates = await wrappedQuery(connection, `
    select r.title, r.start, r.length, r.score, r.\`rank\`
      from article_difficulty_records r
     where r.generation_id = ? and r.\`rank\` = ? and r.block_key >= ?
     order by r.block_key limit ?`, [generation, rank, blockPivot, blockLimit], `
    select r.title, r.start, r.length, r.score, r.\`rank\`
      from article_difficulty_records r
     where r.generation_id = ? and r.\`rank\` = ? and r.block_key < ?
     order by r.block_key limit ?`, [generation, rank, blockPivot, blockLimit]);
  const unique = new Map([...articleCandidates, ...blockCandidates].map(row => [`${row.title}:${row.start}`, row]));
  return { backend: 'mysql', generationId: generation, records: [...unique.values()] };
}

async function composeSampledRows(connection, generation, sources, blockCount) {
  const unique = new Map(sources.filter(source => Number.isInteger(Number(source.start)))
    .map(source => [`${source.title}:${source.start}`, source]));
  sources = [...unique.values()];
  if (!sources.length) return [];
  const blockOffset = (blockCount - 1) * ARTICLE_DIFFICULTY_BLOCK_SIZE;
  const pairs = sources.map(() => '(?, ?)').join(',');
  return mysqlQuery(connection, `
    select s.title, s.start, a.revision,
           e.hard_prefix - s.hard_prefix + s.hard_score as hard_score,
           e.water_prefix - s.water_prefix + s.water_delta as water_delta
      from article_difficulty_records s
      join article_difficulty_records e
        on e.generation_id = s.generation_id and e.title = s.title
       and e.start = s.start + ? and e.length = ?
      join article_difficulty_articles a
        on a.generation_id = s.generation_id and a.title = s.title
     where s.generation_id = ? and s.length = ?
       and (s.title, s.start) in (${pairs})
       and e.valid_prefix - s.valid_prefix + 1 = ?`,
  [blockOffset, ARTICLE_DIFFICULTY_BLOCK_SIZE, generation, ARTICLE_DIFFICULTY_BLOCK_SIZE,
    ...sources.flatMap(source => [source.title, Number(source.start)]), blockCount]);
}

export async function sampleDifficultySegments(connection, rank, length, limit = ARTICLE_DIFFICULTY_CANDIDATE_LIMIT, random = randomKey) {
  if (!Number.isSafeInteger(length) || length < ARTICLE_DIFFICULTY_BLOCK_SIZE * 2) {
    return sampleDifficultyRecords(connection, rank, limit, random);
  }
  const active = await getActiveDifficultyGeneration(connection);
  if (!active || active.algorithm_version !== ARTICLE_DIFFICULTY_ALGORITHM_VERSION || Number(active.block_size) !== ARTICLE_DIFFICULTY_BLOCK_SIZE) {
    return sampleDifficultyRecords(connection, rank, limit, random);
  }
  const blockCount = Math.floor(length / ARTICLE_DIFFICULTY_BLOCK_SIZE);
  try {
    // First use the existing random-key indexes to obtain explicit primary
    // keys. Composing only those keys avoids scanning thousands of short
    // articles that cannot contain the requested long segment.
    const sampled = await sampleDifficultyRecords(connection, rank, ARTICLE_DIFFICULTY_COMPOSED_SAMPLE_LIMIT, random);
    const rows = await composeSampledRows(connection, active.id, sampled?.records || [], blockCount);
    const records = rows.map(row => ({
      title: row.title,
      start: Number(row.start),
      length,
      score: scoreDifficultySummary(row.hard_score, row.water_delta),
      rank,
      revision: row.revision
    })).filter(row => Number.isFinite(row.score));
    records.sort((a, b) => difficultyDistance(a.score, rank) - difficultyDistance(b.score, rank));
    return {
      backend: 'mysql-summary', generationId: active.id,
      records: records.slice(0, Math.min(limit, ARTICLE_DIFFICULTY_COMPOSED_CANDIDATE_LIMIT))
    };
  } catch (error) {
    if (!isMissingDifficultySchema(error)) throw error;
    return sampleDifficultyRecords(connection, rank, limit, random);
  }
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
