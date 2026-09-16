import fs from 'node:fs/promises';
import path from 'node:path';
import { saveArticle, ARTICLE_DIR, validateArticleTitle } from '../dist/articleStorage.js';

export const IMPORT_LIMIT = 10;
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const IMPORT_INTERVAL_MS = 1000;
export const IMPORT_SOURCE_MANIFEST = path.join(ARTICLE_DIR, 'import-sources.json');
export const TEXT_LIST_URL = 'https://www.jsxiaoshi.com/Home/Cloud/getTextList';

const DEFAULT_RANK_URL = 'https://www.jsxiaoshi.com/result_rank.html';

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/giu, (_, entity) => {
    if (entity.toLowerCase() === 'nbsp') return ' ';
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity.toLowerCase()] || _;
  });
}

function htmlText(html) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/giu, '').replace(/<br\s*\/?\s*>|<\/(?:div|p|section|li|tr|h[1-6])\s*>/giu, '\n').replace(/<[^>]+>/gu, ''));
}

export function parseRankPage(html, baseUrl = DEFAULT_RANK_URL) {
  const result = [], seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']*result_search[^"']*)["'][^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(re)) {
    const url = new URL(decodeEntities(match[1]), baseUrl).href;
    if (seen.has(url)) continue;
    seen.add(url);
    result.push({ url, label: htmlText(match[2]).trim() });
  }
  return result;
}

export function parseArticleDetail(html, sourceUrl = '') {
  const content = htmlText(html).replace(/\r\n?/gu, '\n');
  const nameMatch = content.match(/文本名：\s*([^\n]+)/u);
  const bodyMatch = content.match(/文本内容：\s*([\s\S]*?)(?:\n\s*评论\s*\(?\d*\)?|\n\s*程序统计|\s*$)/u);
  if (!nameMatch || !bodyMatch) throw new Error(`详情页未找到文本名或正文：${sourceUrl}`);
  const title = validateArticleTitle(nameMatch[1].trim());
  const body = bodyMatch[1].trim();
  if (!body) throw new Error(`详情页正文为空：${sourceUrl}`);
  return { title, body };
}

async function fetchText(url, signal) {
  const response = await fetch(url, { signal, headers: { 'user-agent': 'qqbot-article-import/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchTextList({ page = 1, pageSize = IMPORT_LIMIT, keyword = '', minChars = '', maxChars = '', signal } = {}) {
  const response = await fetch(TEXT_LIST_URL, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'qqbot-article-import/1.0' },
    body: new URLSearchParams({ textName: keyword, minTextWordNum: minChars, maxTextWordNum: maxChars, currentPage: String(page), pagesize: String(Math.min(pageSize, IMPORT_LIMIT)) })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.error !== 0 || !Array.isArray(data.msg?.list)) throw new Error('文本列表接口返回格式异常。');
  return data.msg;
}

export function parseTextListResponse(data) {
  if (!Array.isArray(data?.list)) throw new Error('文本列表数据缺少 list。');
  return data.list.map(item => ({
    title: String(item.a_name || '').trim(), body: String(item.a_content || ''),
    source: `${TEXT_LIST_URL}?a_id=${encodeURIComponent(item.a_id || item.a_name)}`,
    metadata: { id: item.a_id, author: item.a_author, createdAt: item.a_create_time, chars: item.a_zs }
  }));
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function importArticles({ rankUrls = [DEFAULT_RANK_URL], limit = IMPORT_LIMIT, fetchPage = fetchText, save = saveArticle, sleep = wait, now = () => Date.now(), signal } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > IMPORT_LIMIT) throw new Error(`单次最多导入 ${IMPORT_LIMIT} 篇。`);
  const links = [];
  for (const rankUrl of rankUrls) {
    const page = await fetchPage(rankUrl, signal);
    for (const link of parseRankPage(page, rankUrl)) {
      if (!links.some(item => item.url === link.url)) links.push(link);
      if (links.length >= limit) break;
    }
    if (links.length >= limit) break;
    await sleep(IMPORT_INTERVAL_MS);
  }
  const imported = [], failed = [], sources = [];
  let bytes = 0, lastRequest = 0;
  for (const link of links.slice(0, limit)) {
    try {
      const delay = IMPORT_INTERVAL_MS - (now() - lastRequest);
      if (lastRequest && delay > 0) await sleep(delay);
      lastRequest = now();
      const detail = parseArticleDetail(await fetchPage(link.url, signal), link.url);
      const size = Buffer.byteLength(detail.body, 'utf8');
      if (bytes + size > IMPORT_MAX_BYTES) break;
      const saved = await save(detail.title, detail.body, 'utf-8');
      bytes += size;
      imported.push(saved);
      sources.push({ title: saved.title, url: link.url, importedAt: new Date().toISOString(), bytes: size });
    } catch (error) { failed.push({ url: link.url, error: error.message }); }
  }
  await fs.mkdir(path.dirname(IMPORT_SOURCE_MANIFEST), { recursive: true });
  await fs.writeFile(IMPORT_SOURCE_MANIFEST, JSON.stringify({ updatedAt: new Date().toISOString(), sources }, null, 2));
  return { imported, failed, bytes, sources };
}

export async function importArticlesFromApi({ page = 1, limit = IMPORT_LIMIT, save = saveArticle, sleep = wait, now = () => Date.now(), signal } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > IMPORT_LIMIT) throw new Error(`单次最多导入 ${IMPORT_LIMIT} 篇。`);
  const data = await fetchTextList({ page, pageSize: limit, signal });
  const imported = [], failed = [], sources = [];
  let bytes = 0, lastRequest = 0;
  for (const item of parseTextListResponse(data).slice(0, limit)) {
    try {
      validateArticleTitle(item.title);
      const delay = IMPORT_INTERVAL_MS - (now() - lastRequest);
      if (lastRequest && delay > 0) await sleep(delay);
      lastRequest = now();
      const size = Buffer.byteLength(item.body, 'utf8');
      if (!item.body || bytes + size > IMPORT_MAX_BYTES) break;
      const saved = await save(item.title, item.body, 'utf-8');
      bytes += size; imported.push(saved);
      sources.push({ ...item.metadata, title: saved.title, url: item.source, importedAt: new Date().toISOString(), bytes: size });
    } catch (error) { failed.push({ title: item.title, error: error.message }); }
  }
  await fs.mkdir(path.dirname(IMPORT_SOURCE_MANIFEST), { recursive: true });
  await fs.writeFile(IMPORT_SOURCE_MANIFEST, JSON.stringify({ updatedAt: new Date().toISOString(), sources }, null, 2));
  return { total: Number(data.total || 0), imported, failed, bytes, sources };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rankUrls = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
  const run = rankUrls.length ? importArticles({ rankUrls }) : importArticlesFromApi();
  run.then(result => console.log(`导入完成：接口共 ${result.total || '-'} 篇，成功 ${result.imported.length} 篇，失败 ${result.failed.length} 篇，共 ${result.bytes} 字节。`))
    .catch(error => { console.error(`导入失败：${error.message}`); process.exitCode = 1; });
}
