import { listArticles, validateArticleTitle, readArticleViews } from './articleStorage.js';

function query(connection, sql, values = []) {
  return new Promise((resolve, reject) => connection.query(sql, values, (err, rows) => err ? reject(err) : resolve(rows)));
}

export async function getArticleSettings(connection, qqid) {
  const rows = await query(connection, 'select current_title, segment_length, last_mode, last_title, last_difficulty, last_range_start, last_range_end, last_condition from article_user_settings where qqid = ?', [String(qqid)]);
  return rows[0] || { current_title: null, segment_length: 100, last_mode: null, last_title: null, last_difficulty: null, last_range_start: null, last_range_end: null, last_condition: null };
}

export async function saveLastArticleConfig(connection, qqid, config) {
  const mode = String(config.mode || '');
  if (!['ordered', 'paragraph', 'characters', 'difficulty'].includes(mode)) throw new Error('无效的上次发文模式。');
  await query(connection, `insert into article_user_settings
    (qqid, segment_length, last_mode, last_title, last_difficulty, last_range_start, last_range_end, last_condition)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on duplicate key update segment_length = values(segment_length), last_mode = values(last_mode), last_title = values(last_title), last_difficulty = values(last_difficulty), last_range_start = values(last_range_start), last_range_end = values(last_range_end), last_condition = values(last_condition)`, [
    String(qqid), config.length, mode, config.title ?? null, config.difficulty ?? null,
    config.rangeStart ?? null, config.rangeEnd ?? null, config.condition ?? null
  ]);
}

export async function saveLastArticleCondition(connection, qqid, condition) {
  await query(connection, 'update article_user_settings set last_condition = ? where qqid = ?', [condition || null, String(qqid)]);
}

export async function selectArticle(connection, qqid, title) {
  title = validateArticleTitle(title);
  if (!listArticles().includes(title)) throw new Error(`未找到文章“${title}”。`);
  await query(connection, `insert into article_user_settings (qqid, current_title, segment_length)
    values (?, ?, 100) on duplicate key update current_title = values(current_title)`, [String(qqid), title]);
  return title;
}

export async function setSegmentLength(connection, qqid, length) {
  if (!Number.isInteger(length) || length < 10 || length > 2000) throw new Error('每段字数必须是 10 至 2000 的整数。');
  await query(connection, `insert into article_user_settings (qqid, segment_length)
    values (?, ?) on duplicate key update segment_length = values(segment_length)`, [String(qqid), length]);
  return length;
}

export async function getProgress(connection, qqid, title) {
  const rows = await query(connection, 'select position from article_progress where qqid = ? and title = ?', [String(qqid), title]);
  return Number(rows[0]?.position || 0);
}

export async function setProgress(connection, qqid, title, position) {
  await query(connection, `insert into article_progress (qqid, title, position) values (?, ?, ?)
    on duplicate key update position = values(position)`, [String(qqid), title, position]);
  return position;
}

// Character-indexed features use the compact view so line-break edits never
// shift progress, search positions, or difficulty-map starts.
export async function readArticle(title) { return (await readArticleViews(title)).compactText; }

export function clampProgress(position, length) {
  if (!Number.isSafeInteger(position)) throw new Error('进度必须是整数。');
  return Math.max(0, Math.min(length, position));
}

export function searchArticle(text, keyword, page = 1, pageSize = 10) {
  keyword = String(keyword || '');
  if (!keyword) throw new Error('搜索关键词不能为空。');
  const chars = [...text], needle = [...keyword];
  const hits = [];
  if (needle.length <= chars.length) {
    for (let i = 0; i <= chars.length - needle.length; i++) {
      if (needle.every((char, offset) => chars[i + offset] === char)) hits.push(i + 1);
    }
  }
  const totalPages = Math.max(1, Math.ceil(hits.length / pageSize));
  page = Math.max(1, Math.min(totalPages, Number(page) || 1));
  return { positions: hits, page, totalPages, items: hits.slice((page - 1) * pageSize, page * pageSize).map(position => {
    const start = Math.max(0, position - 11), end = Math.min(chars.length, position - 1 + needle.length + 10);
    return { position, context: chars.slice(start, end).join('') };
  }) };
}
