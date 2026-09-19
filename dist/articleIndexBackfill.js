import { ensureArticleOffsetIndex } from './articleStorage.js';
import { mysqlQuery } from './articleDifficultyCatalog.js';

// Resumable one-article-at-a-time migration. It deliberately does not run as
// part of a query or on module import: callers can stop and invoke it again.
export async function backfillArticleIndexes(connection, titles, onProgress = async () => {}) {
  const result = { ready: 0, failed: 0, failures: [] };
  const list = [...titles];
  for (let i = 0; i < list.length; i++) {
    const title = list[i];
    try {
      const article = await ensureArticleOffsetIndex(title);
      await mysqlQuery(connection, `update article_catalog
        set char_count = ?, byte_count = ?, content_sha256 = ?, index_status = 'ready', index_key = ?,
            index_byte_count = ?, index_stride = ?, index_updated_at = current_timestamp, index_error = null
        where title = ?`, [article.chars, article.bytes, article.sha256, article.indexKey, article.indexByteCount, article.indexStride, title]);
      result.ready++;
      await onProgress({ title, index: i + 1, total: list.length, status: 'ready' });
    } catch (error) {
      result.failed++;
      result.failures.push({ title, error: error.message || String(error) });
      await mysqlQuery(connection, `update article_catalog set index_status = 'failed', index_error = ? where title = ?`, [error.message || String(error), title]).catch(() => {});
      await onProgress({ title, index: i + 1, total: list.length, status: 'failed', error });
    }
  }
  return result;
}
