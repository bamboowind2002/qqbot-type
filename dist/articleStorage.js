import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTICLE_DIR, ARTICLE_TEXT_DIR } from './articlePaths.js';

export { ARTICLE_DIR, ARTICLE_TEXT_DIR } from './articlePaths.js';

export const ARTICLE_MAX_TOTAL_BYTES = 10 * 1024 ** 3;

const articleViewCache = new Map();

const ENCODINGS = new Map([
  ['utf8', 'utf-8'], ['utf-8', 'utf-8'], ['utf16le', 'utf-16le'],
  ['utf-16le', 'utf-16le'], ['gb18030', 'gb18030'], ['gbk', 'gbk'], ['big5', 'big5']
]);

export function validateArticleTitle(title) {
  title = String(title ?? '').trim();
  if (!title || title === '.' || title === '..') throw new Error('文章标题不能为空。');
  if ([...title].length > 255) throw new Error('文章标题不能超过 255 个字符。');
  if (/[\\/\u0000-\u001f\u007f]/u.test(title)) throw new Error('文章标题不能包含路径分隔符或控制字符。');
  if (/\p{White_Space}/u.test(title)) throw new Error('文章标题不能包含空格或其他空白字符。');
  return title;
}

export function articlePath(title) {
  return path.join(ARTICLE_TEXT_DIR, `${validateArticleTitle(title)}.txt`);
}

export function detectArticleEncoding(buffer, explicit) {
  if (explicit) {
    const encoding = ENCODINGS.get(String(explicit).toLowerCase());
    if (!encoding) throw new Error('不支持的编码。可选：UTF-8、UTF-16LE、GB18030、GBK、Big5。');
    return encoding;
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return 'utf-8';
  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) return 'utf-16le';
  if (buffer.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) return 'utf-16be';
  return 'utf-8';
}

export function normalizeArticleText(buffer, explicitEncoding) {
  const encoding = detectArticleEncoding(buffer, explicitEncoding);
  let text = new TextDecoder(encoding, { fatal: false }).decode(buffer);
  // TextDecoder leaves a BOM in some encodings.  Keep line breaks for the
  // line-oriented random mode, while retaining the historical rule that
  // other whitespace is ignored.
  text = text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').replace(/[^\S\n]+/gu, '');
  if (![...text].some(char => char !== '\n')) throw new Error('文章正文不能为空。');
  return text;
}

export function compactArticleText(text) {
  return String(text).replace(/\n/gu, '');
}

export function splitArticleLines(text) {
  return String(text).split('\n').filter(line => line.length > 0);
}

function articleView(text) {
  return { text, lines: splitArticleLines(text), compactText: compactArticleText(text) };
}

export async function readArticleViews(title) {
  const file = articlePath(title);
  const stat = await fsp.stat(file);
  const cached = articleViewCache.get(title);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.view;
  const view = articleView(await fsp.readFile(file, 'utf8').then(buffer => normalizeArticleText(Buffer.from(buffer), 'utf-8')));
  articleViewCache.set(title, { mtimeMs: stat.mtimeMs, size: stat.size, view });
  return view;
}

export function invalidateArticleView(title) { articleViewCache.delete(String(title)); }

function diskFreeBytes(directory) {
  try { return Number(fs.statfsSync(directory).bavail) * Number(fs.statfsSync(directory).bsize); }
  catch (_) { return Infinity; }
}

export function listArticles() {
  if (!fs.existsSync(ARTICLE_TEXT_DIR)) return [];
  return fs.readdirSync(ARTICLE_TEXT_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.txt'))
    .map(entry => entry.name.slice(0, -4)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export async function saveArticle(title, source, explicitEncoding) {
  title = validateArticleTitle(title);
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  await fsp.mkdir(ARTICLE_TEXT_DIR, { recursive: true });
  const text = normalizeArticleText(buffer, explicitEncoding);
  const output = Buffer.from(text, 'utf8');
  const current = fs.existsSync(articlePath(title)) ? fs.statSync(articlePath(title)).size : 0;
  const total = listArticles().reduce((sum, item) => sum + fs.statSync(articlePath(item)).size, 0) - current + output.length;
  if (total > ARTICLE_MAX_TOTAL_BYTES) throw new Error('文章总容量不能超过 10 GiB。');
  if (diskFreeBytes(ARTICLE_TEXT_DIR) - output.length < 10 * 1024 ** 3) throw new Error('磁盘可用空间不足 10 GiB，未保存文章。');
  const temporary = path.join(ARTICLE_TEXT_DIR, `.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    await fsp.writeFile(temporary, output, { flag: 'wx' });
    await fsp.rename(temporary, articlePath(title));
  } finally { await fsp.rm(temporary, { force: true }).catch(() => {}); }
  invalidateArticleView(title);
  return { title, chars: [...compactArticleText(text)].length, bytes: output.length, sha256: crypto.createHash('sha256').update(output).digest('hex') };
}

export async function replaceArticleRange(title, start, end, pattern, replacement) {
  title = validateArticleTitle(title);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start + 1 > 10_000_000) throw new Error('替换区间必须是 1 至 10000000 个字符。');
  const old = await fsp.readFile(articlePath(title));
  const text = normalizeArticleText(old, 'utf-8');
  const chars = [...compactArticleText(text)];
  if (end > chars.length) throw new Error(`文章只有 ${chars.length} 个字符，区间超出范围。`);
  let regex; try { regex = new RegExp(pattern, 'gu'); } catch (err) { throw new Error(`正则表达式无效：${err.message}`); }
  const selected = chars.slice(start - 1, end).join('').replace(regex, replacement ?? '');
  const compactPositions = [];
  for (let index = 0, compact = 0; index < [...text].length; index++) {
    const char = [...text][index];
    if (char !== '\n') { compactPositions[compact] = index; compact++; }
  }
  const rawChars = [...text];
  const rawStart = compactPositions[start - 1];
  const rawEnd = compactPositions[end - 1] + 1;
  rawChars.splice(rawStart, rawEnd - rawStart, ...[...selected]);
  return saveArticle(title, rawChars.join(''), 'utf-8');
}

export async function deleteArticle(title) {
  await fsp.rm(articlePath(title));
  invalidateArticleView(title);
  const { removeArticleFromAllCategories } = await import('./articleCategories.js');
  await removeArticleFromAllCategories(title);
  return title;
}
