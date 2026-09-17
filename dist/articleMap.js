import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTICLE_DIR, listArticles, readArticleViews } from './articleStorage.js';
import { get_rank } from './rank.js';
import { isValidDifficultyResult } from './articleDifficulty.js';
import { sliceCodePoints } from './unicodeText.js';
import { ARTICLE_DIFFICULTY_ALGORITHM_VERSION, mysqlQuery, randomKey } from './articleDifficultyStore.js';

export const ARTICLE_MAP_PATH = path.join(ARTICLE_DIR, 'difficulty-map.json');
export const ARTICLE_MAP_BLOCK_SIZE = 100;
export const ARTICLE_MAP_INSERT_BATCH_SIZE = 1000;

let task = null;
let cancelRequested = false;

export function difficultyBlockRanges(length, blockSize = ARTICLE_MAP_BLOCK_SIZE) {
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(blockSize) || blockSize < 1) return [];
  const result = [];
  for (let start = 0; start < length; start += blockSize) result.push({ start, length: Math.min(blockSize, length - start) });
  return result;
}

export function canReuseDifficultyGeneration(active, algorithmVersion = ARTICLE_DIFFICULTY_ALGORITHM_VERSION, blockSize = ARTICLE_MAP_BLOCK_SIZE) {
  return Boolean(active && active.algorithm_version === algorithmVersion && Number(active.block_size) === blockSize);
}

export function filterDifficultyMapRecords(records) {
  return Array.isArray(records) ? records.filter(record => isValidDifficultyResult(record?.score, record?.rank)) : [];
}

async function loadRawMap() {
  try { return JSON.parse(await fs.readFile(ARTICLE_MAP_PATH, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { records: [] }; throw error; }
}

async function loadMap() {
  const map = await loadRawMap();
  return { ...map, records: filterDifficultyMapRecords(map.records) };
}

export async function readDifficultyMap() { return loadMap(); }

export async function sanitizeDifficultyMap() {
  const map = await loadRawMap();
  const records = filterDifficultyMapRecords(map.records);
  const removed = (Array.isArray(map.records) ? map.records.length : 0) - records.length;
  if (removed) await writeMap({ ...map, records });
  return { removed, remaining: records.length };
}

export async function renameDifficultyMapTitle(oldTitle, newTitle) {
  const map = await loadMap();
  let changed = false;
  const records = (map.records || []).map(record => {
    if (record.title !== oldTitle) return record;
    changed = true;
    return { ...record, title: newTitle };
  });
  if (changed) await writeMap({ ...map, records, updatedAt: new Date().toISOString() });
  return changed;
}

async function writeMap(map) {
  map = { ...map, records: filterDifficultyMapRecords(map.records) };
  await fs.mkdir(path.dirname(ARTICLE_MAP_PATH), { recursive: true });
  const temporary = `${ARTICLE_MAP_PATH}.${process.pid}.${Date.now()}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(map), { flag: 'wx' }); await fs.rename(temporary, ARTICLE_MAP_PATH); }
  finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

export function getDifficultyMapStatus() {
  return task ? { ...task, backend: 'mysql', running: true, cancelRequested } : { backend: 'mysql', running: false };
}

export function cancelDifficultyMapSync() {
  if (!task) return false;
  cancelRequested = true;
  return true;
}

async function insertRecords(connection, rows) {
  if (!rows.length) return;
  const placeholders = rows.map(() => '(?,?,?,?,?,?,?,?)').join(',');
  await mysqlQuery(connection, `insert into article_difficulty_records
    (generation_id, title, start, length, score, \`rank\`, article_key, block_key)
    values ${placeholders}`,
  rows.flatMap(row => [row.generationId, row.title, row.start, row.length, row.score, row.rank, row.articleKey, row.blockKey]));
}

async function insertArticles(connection, rows) {
  if (!rows.length) return;
  const placeholders = rows.map(() => '(?,?,?,?,?,?)').join(',');
  await mysqlQuery(connection, `insert into article_difficulty_articles
    (generation_id, title, revision, total_block_count, valid_record_count, invalid_record_count)
    values ${placeholders}`, rows.flatMap(row => [row.generationId, row.title, row.revision, row.total, row.valid, row.invalid]));
}

async function updateArticles(connection, rows) {
  if (!rows.length) return;
  const placeholders = rows.map(() => '(?,?,?,?,?,?)').join(',');
  await mysqlQuery(connection, `insert into article_difficulty_articles
    (generation_id, title, revision, total_block_count, valid_record_count, invalid_record_count)
    values ${placeholders}
    on duplicate key update revision=values(revision), total_block_count=values(total_block_count),
      valid_record_count=values(valid_record_count), invalid_record_count=values(invalid_record_count)`,
  rows.flatMap(row => [row.generationId, row.title, row.revision, row.total, row.valid, row.invalid]));
}

async function createGeneration(connection, articleCount) {
  const result = await mysqlQuery(connection, `insert into article_difficulty_generations
    (algorithm_version, block_size, status, article_count)
    values (?, ?, 'building', ?)`, [ARTICLE_DIFFICULTY_ALGORITHM_VERSION, ARTICLE_MAP_BLOCK_SIZE, articleCount]);
  return result.insertId;
}

async function activeGeneration(connection) {
  const rows = await mysqlQuery(connection, `select g.id, g.algorithm_version, g.block_size
    from article_difficulty_state s join article_difficulty_generations g on g.id = s.active_generation_id
    where s.singleton_id = 1 and g.status = 'complete' limit 1`);
  return rows[0] || null;
}

async function calculateArticle(connection, generationId, title, view) {
  const ranges = difficultyBlockRanges(view.compactIndex.length);
  const articleKey = randomKey();
  let valid = 0, invalid = 0, batch = [];
  for (const range of ranges) {
    if (cancelRequested) break;
    try {
      const text = sliceCodePoints(view.compactText, range.start, range.length, view.compactIndex);
      const [score, , rank, error] = get_rank(text);
      if (isValidDifficultyResult(score, rank, error)) {
        batch.push({ generationId, title, ...range, score, rank, articleKey, blockKey: randomKey() });
        valid++;
      } else invalid++;
    } catch (_) { invalid++; }
    if (batch.length >= ARTICLE_MAP_INSERT_BATCH_SIZE) {
      await insertRecords(connection, batch);
      batch = [];
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  await insertRecords(connection, batch);
  if (cancelRequested) return null;
  return { total: ranges.length, valid, invalid, revision: view.compactRevision };
}

async function copyReusableRecords(connection, sourceGeneration, generationId, titles) {
  if (!titles.length) return;
  await mysqlQuery(connection, 'create temporary table article_difficulty_reuse_titles (title varchar(255) not null primary key) engine=InnoDB');
  for (let index = 0; index < titles.length; index += ARTICLE_MAP_INSERT_BATCH_SIZE) {
    const batch = titles.slice(index, index + ARTICLE_MAP_INSERT_BATCH_SIZE);
    await mysqlQuery(connection, `insert into article_difficulty_reuse_titles (title) values ${batch.map(() => '(?)').join(',')}`, batch);
  }
  await mysqlQuery(connection, `insert into article_difficulty_records
    (generation_id, title, start, length, score, \`rank\`, article_key, block_key)
    select ?, r.title, r.start, r.length, r.score, r.\`rank\`, r.article_key, r.block_key
      from article_difficulty_records r join article_difficulty_reuse_titles u on u.title = r.title
     where r.generation_id = ?`, [generationId, sourceGeneration]);
}

async function publishGeneration(connection, generationId, totals) {
  await mysqlQuery(connection, 'start transaction');
  try {
    await mysqlQuery(connection, `update article_difficulty_generations set status = 'complete', processed_articles = article_count,
      total_block_count = ?, valid_record_count = ?, invalid_record_count = ?, completed_at = now(3), published_at = now(3)
      where id = ? and status = 'building'`, [totals.total, totals.valid, totals.invalid, generationId]);
    await mysqlQuery(connection, `insert into article_difficulty_state (singleton_id, active_generation_id)
      values (1, ?) on duplicate key update active_generation_id = values(active_generation_id)`, [generationId]);
    await mysqlQuery(connection, 'commit');
  } catch (error) {
    await mysqlQuery(connection, 'rollback').catch(() => {});
    throw error;
  }
}

async function cleanupGenerations(connection) {
  const keep = await mysqlQuery(connection, `select id from article_difficulty_generations
    where status = 'complete' order by id desc limit 2`);
  const ids = keep.map(row => row.id);
  if (ids.length) await mysqlQuery(connection, 'delete from article_difficulty_generations where id not in (?)', [ids]);
}

export async function syncDifficultyMap(connection, onProgress = () => {}) {
  if (task) throw new Error('难度地图正在同步中。');
  if (!connection) throw new Error('同步难度地图需要 MySQL 连接。');
  const titles = listArticles();
  const generationId = await createGeneration(connection, titles.length);
  task = { generationId, processed: 0, total: titles.length, changed: 0, records: 0, totalBlocks: 0, invalid: 0, startedAt: Date.now() };
  cancelRequested = false;
  onProgress({ ...task });
  try {
    const active = await activeGeneration(connection);
    const reusable = canReuseDifficultyGeneration(active);
    const oldArticles = new Map();
    if (reusable) {
      const rows = await mysqlQuery(connection, `select title, revision, total_block_count, valid_record_count, invalid_record_count
        from article_difficulty_articles where generation_id = ?`, [active.id]);
      for (const row of rows) oldArticles.set(row.title, row);
    }
    const reuseRows = [], changedRows = [], metadataRows = [];
    for (const title of titles) {
      if (cancelRequested) break;
      const view = await readArticleViews(title);
      const total = difficultyBlockRanges(view.compactIndex.length).length;
      const old = oldArticles.get(title);
      if (reusable && old?.revision === view.compactRevision) {
        reuseRows.push({ title, revision: old.revision, total: Number(old.total_block_count), valid: Number(old.valid_record_count), invalid: Number(old.invalid_record_count) });
        metadataRows.push({ generationId, title, revision: old.revision, total: Number(old.total_block_count), valid: Number(old.valid_record_count), invalid: Number(old.invalid_record_count) });
      } else {
        changedRows.push({ title, revision: view.compactRevision, total });
        metadataRows.push({ generationId, title, revision: view.compactRevision, total, valid: 0, invalid: total });
      }
    }
    for (let index = 0; index < metadataRows.length && !cancelRequested; index += ARTICLE_MAP_INSERT_BATCH_SIZE) {
      await insertArticles(connection, metadataRows.slice(index, index + ARTICLE_MAP_INSERT_BATCH_SIZE));
    }
    if (cancelRequested) {
      await mysqlQuery(connection, `update article_difficulty_generations set status = 'failed', processed_articles = ?,
        error_message = 'cancelled', completed_at = now(3) where id = ?`, [task.processed, generationId]);
      return { cancelled: true, ...task };
    }
    await copyReusableRecords(connection, active?.id, generationId, reuseRows.map(row => row.title));
    const completedUpdates = [];
    for (const row of reuseRows) {
      if (cancelRequested) break;
      task.processed++;
      task.records += row.valid;
      task.totalBlocks += row.total;
      task.invalid += row.invalid;
      if (task.processed % 500 === 0) onProgress({ ...task });
    }
    for (const item of changedRows) {
      if (cancelRequested) break;
      const view = await readArticleViews(item.title);
      const counts = await calculateArticle(connection, generationId, item.title, view);
      if (!counts) break;
      completedUpdates.push({ generationId, title: item.title, revision: counts.revision, total: counts.total, valid: counts.valid, invalid: counts.invalid });
      task.processed++;
      task.records += counts.valid;
      task.totalBlocks += counts.total;
      task.invalid += counts.invalid;
      if (completedUpdates.length >= ARTICLE_MAP_INSERT_BATCH_SIZE) {
        await updateArticles(connection, completedUpdates.splice(0));
      }
      if (task.processed % 500 === 0 || task.processed === task.total) onProgress({ ...task });
      await new Promise(resolve => setImmediate(resolve));
    }
    await updateArticles(connection, completedUpdates);
    task.changed = changedRows.length;
    await mysqlQuery(connection, `update article_difficulty_generations
      set processed_articles = ?, total_block_count = ?, valid_record_count = ?, invalid_record_count = ? where id = ?`,
    [task.processed, task.totalBlocks, task.records, task.invalid, generationId]);
    onProgress({ ...task });
    if (cancelRequested) {
      await mysqlQuery(connection, `update article_difficulty_generations set status = 'failed', processed_articles = ?,
        total_block_count = ?, valid_record_count = ?, invalid_record_count = ?, error_message = 'cancelled', completed_at = now(3) where id = ?`,
      [task.processed, task.totalBlocks, task.records, task.invalid, generationId]);
      return { cancelled: true, ...task };
    }
    await publishGeneration(connection, generationId, { total: task.totalBlocks, valid: task.records, invalid: task.invalid });
    // Publishing is already committed; retention cleanup must never demote the
    // newly active generation if a later DELETE fails.
    await cleanupGenerations(connection).catch(() => {});
    return { cancelled: false, ...task, articleCount: titles.length };
  } catch (error) {
    await mysqlQuery(connection, `update article_difficulty_generations set status = 'failed', processed_articles = ?,
      total_block_count = ?, valid_record_count = ?, invalid_record_count = ?, error_message = ?, completed_at = now(3) where id = ?`,
    [task.processed, task.totalBlocks, task.records, task.invalid, String(error.message || error).slice(0, 1000), generationId]).catch(() => {});
    throw error;
  } finally { task = null; cancelRequested = false; }
}
