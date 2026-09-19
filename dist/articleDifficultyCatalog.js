import { removeArticleIndexFile } from './articleStorage.js';

function query(connection, sql, values = []) {
  return new Promise((resolve, reject) => connection.query(sql, values, (error, rows) => error ? reject(error) : resolve(rows)));
}

export function buildDifficultyIndex(rows) {
  const items = rows.map(row => ({
    title: String(row.title),
    length: Number(row.char_count),
    revision: row.content_sha256 || null,
    indexKey: row.index_key || row.content_sha256 || null,
    updatedAt: row.updated_at || null
  })).filter(row => Number.isSafeInteger(row.length) && row.length >= 0)
    .sort((a, b) => b.length - a.length || a.title.localeCompare(b.title, 'zh-CN'));
  const prefixLengths = [];
  let total = 0;
  for (const item of items) { total += item.length; prefixLengths.push(total); }
  return { items, prefixLengths };
}

export function weightedDifficultySelection(index, length, random = Math.random) {
  if (!Number.isInteger(length) || length < 1) throw new Error('文章片段长度必须是正整数。');
  let low = 0, high = index.items.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (index.items[middle].length >= length) low = middle + 1;
    else high = middle;
  }
  const count = low;
  if (!count) return null;
  const totalLength = index.prefixLengths[count - 1];
  const totalWeight = totalLength - count * (length - 1);
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) throw new Error('难度发文取样权重超出安全整数范围。');
  const raw = random();
  if (!(raw >= 0 && raw < 1)) throw new Error('随机数必须位于 [0, 1)。');
  const target = Math.min(totalWeight - 1, Math.floor(raw * totalWeight));
  low = 0; high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    const prefix = index.prefixLengths[middle] - (middle + 1) * (length - 1);
    if (prefix > target) high = middle;
    else low = middle + 1;
  }
  const selected = low;
  const previous = selected === 0 ? 0 : index.prefixLengths[selected - 1] - selected * (length - 1);
  return {
    title: index.items[selected].title,
    start: target - previous,
    length,
    articleLength: index.items[selected].length,
    revision: index.items[selected].revision,
    indexKey: index.items[selected].indexKey
  };
}

export function mysqlQuery(connection, sql, values = []) { return query(connection, sql, values); }

export async function getCatalogRevision(connection) {
  const rows = await query(connection, 'select revision from article_catalog_state where singleton_id = 1 limit 1');
  return Number(rows[0]?.revision || 0);
}

export async function loadDifficultyIndex(connection) {
  const rows = await query(connection, `
    select distinct a.title, a.char_count, a.content_sha256, a.updated_at
      from article_catalog a
      join article_category_members m on m.title = a.title
      join article_categories c on c.category = m.category
     where c.difficulty_enabled = 1
       and a.index_status = 'ready'
       and a.index_key is not null
     order by a.char_count desc, a.title asc`);
  return buildDifficultyIndex(rows);
}

export async function bumpCatalogRevision(connection) {
  await query(connection, `insert into article_catalog_state (singleton_id, revision)
    values (1, 1)
    on duplicate key update revision = revision + 1`);
}

export async function upsertArticleCatalog(connection, article) {
  const oldRows = await query(connection, 'select index_key from article_catalog where title = ? limit 1', [article.title]);
  const oldIndexKey = oldRows[0]?.index_key || null;
  const newIndexKey = article.indexKey || article.sha256;
  await query(connection, `insert into article_catalog
    (title, char_count, byte_count, content_sha256, index_status, index_key, index_byte_count, index_stride, index_updated_at, index_error)
    values (?, ?, ?, ?, 'ready', ?, ?, ?, current_timestamp, null)
    on duplicate key update char_count = values(char_count), byte_count = values(byte_count), content_sha256 = values(content_sha256),
      index_status = values(index_status), index_key = values(index_key), index_byte_count = values(index_byte_count), index_stride = values(index_stride),
      index_updated_at = values(index_updated_at), index_error = null, updated_at = current_timestamp`,
  [article.title, article.chars, article.bytes, article.sha256, newIndexKey, article.indexByteCount || null, article.indexStride || null]);
  if (oldIndexKey && oldIndexKey !== newIndexKey) {
    const references = await query(connection, 'select count(*) as count from article_catalog where index_key = ?', [oldIndexKey]);
    if (!Number(references[0]?.count || 0)) await removeArticleIndexFile(oldIndexKey).catch(() => {});
  }
  await bumpCatalogRevision(connection);
}

export async function removeArticleCatalog(connection, title) {
  await query(connection, 'delete from article_category_members where title = ?', [title]);
  await query(connection, 'delete from article_catalog where title = ?', [title]);
  await bumpCatalogRevision(connection);
}

export async function renameArticleCatalog(connection, oldTitle, newTitle) {
  await query(connection, 'update article_catalog set title = ? where title = ?', [newTitle, oldTitle]);
  await query(connection, 'update article_category_members set title = ? where title = ?', [newTitle, oldTitle]);
  await bumpCatalogRevision(connection);
}

export async function ensureArticleCategory(connection, category, enabled = false) {
  await query(connection, `insert into article_categories (category, difficulty_enabled)
    values (?, ?) on duplicate key update category = values(category)`, [category, enabled ? 1 : 0]);
}

export async function ensureExistingArticleCategory(connection, category) {
  await query(connection, `insert into article_categories (category, difficulty_enabled)
    values (?, 1) on duplicate key update category = values(category)`, [category]);
}

export async function syncArticleDifficultyCatalog(connection, titles, scanMetadata, categoryEntries) {
  for (const category of categoryEntries) {
    await ensureExistingArticleCategory(connection, category.category);
    const validTitles = category.titles.filter(title => titles.has(title));
    for (let offset = 0; offset < validTitles.length; offset += 1000) {
      const chunk = validTitles.slice(offset, offset + 1000);
      if (!chunk.length) continue;
      await query(connection, `insert ignore into article_category_members (category, title) values ${chunk.map(() => '(?, ?)').join(',')}`,
        chunk.flatMap(title => [category.category, title]));
    }
  }
  const existingRows = titles.size
    ? await query(connection, 'select title from article_catalog where title in (?)', [[...titles]])
    : [];
  const existing = new Set(existingRows.map(row => row.title));
  for (const title of titles) {
    if (existing.has(title)) continue;
    const metadata = await scanMetadata(title);
    await query(connection, `insert into article_catalog (title, char_count, byte_count, content_sha256, index_status, index_key)
      values (?, ?, ?, ?, 'pending', ?)
      on duplicate key update char_count = values(char_count), byte_count = values(byte_count), content_sha256 = values(content_sha256), index_status = 'pending', index_key = values(index_key)`,
    [title, metadata.compactLength, metadata.size, metadata.textRevision, metadata.textRevision]);
  }
  await bumpCatalogRevision(connection);
}

export async function addArticleCategoryRecord(connection, category, title) {
  await ensureArticleCategory(connection, category, false);
  await query(connection, `insert ignore into article_category_members (category, title) values (?, ?)`, [category, title]);
  await bumpCatalogRevision(connection);
}

export async function removeArticleCategoryRecord(connection, category, title) {
  await query(connection, 'delete from article_category_members where category = ? and title = ?', [category, title]);
  await bumpCatalogRevision(connection);
}

export async function renameArticleCategoryRecord(connection, oldCategory, newCategory) {
  await query(connection, 'update article_categories set category = ? where category = ?', [newCategory, oldCategory]);
  await query(connection, 'update article_category_members set category = ? where category = ?', [newCategory, oldCategory]);
  await bumpCatalogRevision(connection);
}

export async function setArticleCategoryDifficulty(connection, category, enabled) {
  await ensureArticleCategory(connection, category, false);
  await query(connection, 'update article_categories set difficulty_enabled = ? where category = ?', [enabled ? 1 : 0, category]);
  await bumpCatalogRevision(connection);
}

export async function listArticleCategoryDifficulty(connection) {
  return query(connection, `select c.category, c.difficulty_enabled, count(m.title) as article_count
    from article_categories c left join article_category_members m on m.category = c.category
   group by c.category, c.difficulty_enabled order by c.category`);
}
