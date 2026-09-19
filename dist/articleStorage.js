import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { ARTICLE_DIR, ARTICLE_TEXT_DIR } from './articlePaths.js';
import { countCodePoints, createCodePointIndex } from './unicodeText.js';
import { articleUserError } from './articleErrors.js';

export { ARTICLE_DIR, ARTICLE_TEXT_DIR } from './articlePaths.js';

export const ARTICLE_MAX_TOTAL_BYTES = 10 * 1024 ** 3;

const articleViewCache = new Map();
const ARTICLE_VIEW_CACHE_MAX_BYTES = 64 * 1024 ** 2;
let articleViewCacheBytes = 0;
const articleMetadataCache = new Map();
const ARTICLE_METADATA_CACHE_MAX_BYTES = 16 * 1024 ** 2;
let articleMetadataCacheBytes = 0;

const ENCODINGS = new Map([
  ['utf8', 'utf-8'], ['utf-8', 'utf-8'], ['utf16le', 'utf-16le'],
  ['utf-16le', 'utf-16le'], ['gb18030', 'gb18030'], ['gbk', 'gbk'], ['big5', 'big5']
]);

export function validateArticleTitle(title) {
  title = String(title ?? '').replace(/\p{White_Space}/gu, '');
  if (!title || title === '.' || title === '..') throw new Error('文章标题不能为空。');
  if ([...title].length > 255) throw new Error('文章标题不能超过 255 个字符。');
  if (/[\\/\u0000-\u001f\u007f]/u.test(title)) throw new Error('文章标题不能包含路径分隔符或控制字符。');
  if (/\p{White_Space}/u.test(title)) throw new Error('文章标题不能包含空格或其他空白字符。');
  return title;
}

export function articlePath(title) {
  return path.join(ARTICLE_TEXT_DIR, `${validateArticleTitle(title)}.txt`);
}

export async function renameArticle(oldTitle, newTitle) {
  oldTitle = validateArticleTitle(oldTitle);
  newTitle = validateArticleTitle(newTitle);
  if (oldTitle === newTitle) throw new Error('新旧文章标题相同，无需重命名。');
  const source = articlePath(oldTitle), target = articlePath(newTitle);
  const sourceStat = await fsp.stat(source).catch(err => {
    if (err.code === 'ENOENT') throw articleUserError(`文章“${oldTitle}”不存在。`, { cause: err });
    throw err;
  });
  if (!sourceStat.isFile()) throw new Error(`文章“${oldTitle}”不是普通文件。`);
  try {
    await fsp.lstat(target);
    throw new Error(`文章“${newTitle}”已存在。`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const { renameArticleCategoryLinks } = await import('./articleCategories.js');
  await fsp.rename(source, target);
  try {
    await renameArticleCategoryLinks(oldTitle, newTitle);
  } catch (err) {
    await fsp.rename(target, source).catch(() => {});
    throw err;
  }
  invalidateArticleView(oldTitle);
  invalidateArticleView(newTitle);
  return { oldTitle, newTitle };
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
  const lines = splitArticleLines(text);
  const lineLengths = lines.map(countCodePoints);
  const linePrefix = [0];
  for (const length of lineLengths) linePrefix.push(linePrefix.at(-1) + length);
  const compactText = compactArticleText(text);
  const compactIndex = createCodePointIndex(compactText);
  const textRevision = crypto.createHash('sha256').update(text).digest('hex');
  const compactRevision = crypto.createHash('sha256').update(compactText).digest('hex');
  return { text, textRevision, lines, lineLengths, linePrefix, compactText, compactIndex, compactRevision };
}

function estimateArticleViewBytes(view) {
  return (view.text.length + view.compactText.length) * 2 + view.lines.length * 64 +
    view.lineLengths.length * 8 + view.linePrefix.length * 8 + view.compactIndex.offsets.length * 8;
}

function cacheArticleView(title, value) {
  const previous = articleViewCache.get(title);
  if (previous) articleViewCacheBytes -= previous.bytes;
  articleViewCache.delete(title);
  articleViewCache.set(title, value);
  articleViewCacheBytes += value.bytes;
  while (articleViewCacheBytes > ARTICLE_VIEW_CACHE_MAX_BYTES && articleViewCache.size > 1) {
    const oldestTitle = articleViewCache.keys().next().value;
    const oldest = articleViewCache.get(oldestTitle);
    articleViewCache.delete(oldestTitle);
    articleViewCacheBytes -= oldest.bytes;
  }
}

export async function readArticleViews(title) {
  const file = articlePath(title);
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw articleUserError(`文章“${title}”不存在。`, { cause: err });
    throw err;
  }
  const cached = articleViewCache.get(title);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    articleViewCache.delete(title);
    articleViewCache.set(title, cached);
    return cached.view;
  }
  let source;
  try {
    source = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw articleUserError(`文章“${title}”不存在。`, { cause: err });
    throw err;
  }
  const view = articleView(normalizeArticleText(Buffer.from(source), 'utf-8'));
  cacheArticleView(title, { mtimeMs: stat.mtimeMs, size: stat.size, view, bytes: estimateArticleViewBytes(view) });
  return view;
}

function articleChangedError(title) {
  const error = new Error(`文章“${title}”在读取期间发生变化，请重试。`);
  error.code = 'ARTICLE_CHANGED';
  return error;
}

function estimateArticleMetadataBytes(metadata) {
  return 256 + metadata.lineLengths.length * 8;
}

function cloneArticleMetadata(metadata) {
  return { ...metadata, lineLengths: [...metadata.lineLengths] };
}

function cacheArticleMetadata(title, metadata) {
  const previous = articleMetadataCache.get(title);
  if (previous) articleMetadataCacheBytes -= previous.bytes;
  const entry = { metadata, bytes: estimateArticleMetadataBytes(metadata) };
  articleMetadataCache.delete(title);
  articleMetadataCache.set(title, entry);
  articleMetadataCacheBytes += entry.bytes;
  while (articleMetadataCacheBytes > ARTICLE_METADATA_CACHE_MAX_BYTES && articleMetadataCache.size > 1) {
    const oldestTitle = articleMetadataCache.keys().next().value;
    const oldest = articleMetadataCache.get(oldestTitle);
    articleMetadataCache.delete(oldestTitle);
    articleMetadataCacheBytes -= oldest.bytes;
  }
}

async function articleStat(title) {
  try {
    return await fsp.stat(articlePath(title));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw articleUserError(`文章“${title}”不存在。`, { cause: err });
    throw err;
  }
}

// Scan only the small amount of information needed by the posting modes. The
// StringDecoder keeps a UTF-8 code point intact when it crosses a stream chunk.
export async function scanArticleMetadata(title) {
  const file = articlePath(title);
  const before = await articleStat(title);
  const cached = articleMetadataCache.get(title);
  if (cached && cached.metadata.mtimeMs === before.mtimeMs && cached.metadata.size === before.size) {
    articleMetadataCache.delete(title);
    articleMetadataCache.set(title, cached);
    return cloneArticleMetadata(cached.metadata);
  }
  const textHash = crypto.createHash('sha256');
  const compactHash = crypto.createHash('sha256');
  const decoder = new StringDecoder('utf8');
  const lineLengths = [];
  let lineLength = 0, compactLength = 0;
  const stream = fs.createReadStream(file);
  try {
    for await (const chunk of stream) {
      const text = decoder.write(chunk);
      textHash.update(text);
      for (const char of text) {
        if (char === '\n') {
          if (lineLength) lineLengths.push(lineLength);
          lineLength = 0;
        } else {
          lineLength++;
          compactLength++;
          compactHash.update(char);
        }
      }
    }
    const tail = decoder.end();
    if (tail) {
      textHash.update(tail);
      for (const char of tail) { lineLength++; compactLength++; compactHash.update(char); }
    }
    if (lineLength) lineLengths.push(lineLength);
  } finally { stream.destroy(); }
  const after = await articleStat(title);
  if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw articleChangedError(title);
  const metadata = {
    compactLength,
    lineLengths,
    lineCount: lineLengths.length,
    textRevision: textHash.digest('hex'),
    compactRevision: compactHash.digest('hex'),
    mtimeMs: after.mtimeMs,
    size: after.size
  };
  cacheArticleMetadata(title, metadata);
  return cloneArticleMetadata(metadata);
}

// Difficulty sampling already has the compact length in article_catalog. Avoid
// scanning the whole article again just to obtain the stat fields required by
// readArticleSelection.
export async function readArticleSelectionMetadata(title, compactLength, revision = null) {
  const stat = await articleStat(title);
  return {
    compactLength,
    lineLengths: [],
    lineCount: 0,
    textRevision: revision,
    compactRevision: revision,
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };
}

function validateSelection(selection, metadata) {
  if (!selection || !['compact', 'lines'].includes(selection.type)) throw new Error('无效的文章片段选择。');
  if (!Number.isSafeInteger(selection.length) || selection.length < 0) throw new Error('文章片段长度无效。');
  if (selection.type === 'compact') {
    if (!Number.isSafeInteger(selection.start) || selection.start < 0 || selection.start + selection.length > metadata.compactLength) throw new Error('文章片段范围无效。');
  } else if (!Array.isArray(selection.indexes) || selection.indexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= metadata.lineCount)) {
    throw new Error('文章行号范围无效。');
  }
}

export async function readArticleSelection(title, selection, metadata) {
  validateSelection(selection, metadata);
  const before = await articleStat(title);
  if (before.mtimeMs !== metadata.mtimeMs || before.size !== metadata.size) throw articleChangedError(title);
  const decoder = new StringDecoder('utf8');
  const stream = fs.createReadStream(articlePath(title));
  const output = [];
  const selected = selection.type === 'lines' ? new Map(selection.indexes.map((index, order) => [index, order])) : null;
  const maxSelectedLine = selected ? Math.max(-1, ...selection.indexes) : -1;
  const lineParts = selected ? Array.from({ length: selection.indexes.length }, () => []) : null;
  let compactPosition = 0, lineIndex = 0, lineBuffer = [];
  let done = selection.length === 0;
  const consume = text => {
    for (const char of text) {
      if (selection.type === 'compact') {
        if (char !== '\n') {
          if (compactPosition >= selection.start && output.length < selection.length) output.push(char);
          compactPosition++;
          if (output.length >= selection.length) return true;
        }
      } else if (char === '\n') {
        if (lineBuffer.length && selected.has(lineIndex)) lineParts[selected.get(lineIndex)] = lineBuffer;
        if (lineBuffer.length) {
          lineIndex++;
          if (lineIndex > maxSelectedLine) return true;
        }
        lineBuffer = [];
      } else {
        lineBuffer.push(char);
      }
    }
    return false;
  };
  try {
    if (!done) {
      for await (const chunk of stream) {
        if (consume(decoder.write(chunk))) { done = true; break; }
      }
      if (!done) {
        const tail = decoder.end();
        if (tail) consume(tail);
        if (selection.type === 'lines' && lineBuffer.length && selected.has(lineIndex)) lineParts[selected.get(lineIndex)] = lineBuffer;
      }
    }
  } finally { stream.destroy(); }
  if (selection.type === 'lines') {
    for (const part of lineParts) {
      for (const char of part) { if (output.length >= selection.length) break; output.push(char); }
      if (output.length >= selection.length) break;
    }
  }
  const after = await articleStat(title);
  if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw articleChangedError(title);
  return { text: output.join(''), textRevision: metadata.textRevision, compactRevision: metadata.compactRevision };
}

export function invalidateArticleView(title) {
  const key = String(title), cached = articleViewCache.get(key);
  if (cached) articleViewCacheBytes -= cached.bytes;
  articleViewCache.delete(key);
  const metadata = articleMetadataCache.get(key);
  if (metadata) articleMetadataCacheBytes -= metadata.bytes;
  articleMetadataCache.delete(key);
}

function diskFreeBytes(directory) {
  try { return Number(fs.statfsSync(directory).bavail) * Number(fs.statfsSync(directory).bsize); }
  catch (_) { return Infinity; }
}

export function listArticles({ sort = true } = {}) {
  if (!fs.existsSync(ARTICLE_TEXT_DIR)) return [];
  const titles = fs.readdirSync(ARTICLE_TEXT_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.txt'))
    .map(entry => entry.name.slice(0, -4));
  return sort ? titles.sort((a, b) => a.localeCompare(b, 'zh-CN')) : titles;
}

async function writeArticle(title, text, state = null) {
  title = validateArticleTitle(title);
  const output = Buffer.from(text, 'utf8');
  const target = articlePath(title);
  let current = 0;
  if (state) {
    current = state.sizes.get(title) || 0;
  } else if (fs.existsSync(target)) {
    current = fs.statSync(target).size;
  }
  const total = state ? state.totalBytes - current + output.length : listArticles().reduce((sum, item) => sum + fs.statSync(articlePath(item)).size, 0) - current + output.length;
  if (total > ARTICLE_MAX_TOTAL_BYTES) throw new Error('文章总容量不能超过 10 GiB。');
  if ((!state || state.writes % 256 === 0) && diskFreeBytes(ARTICLE_TEXT_DIR) - output.length < 10 * 1024 ** 3) throw new Error('磁盘可用空间不足 10 GiB，未保存文章。');
  const temporary = path.join(ARTICLE_TEXT_DIR, `.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    await fsp.writeFile(temporary, output, { flag: 'wx' });
    await fsp.rename(temporary, target);
  } finally { await fsp.rm(temporary, { force: true }).catch(() => {}); }
  if (state) {
    state.totalBytes = total;
    state.sizes.set(title, output.length);
    state.writes++;
  }
  invalidateArticleView(title);
  return { title, chars: [...compactArticleText(text)].length, bytes: output.length, sha256: crypto.createHash('sha256').update(output).digest('hex') };
}

export async function saveArticle(title, source, explicitEncoding) {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source);
  await fsp.mkdir(ARTICLE_TEXT_DIR, { recursive: true });
  return writeArticle(title, normalizeArticleText(buffer, explicitEncoding));
}

export async function createArticleBatchWriter() {
  await fsp.mkdir(ARTICLE_TEXT_DIR, { recursive: true });
  const sizes = new Map();
  let totalBytes = 0;
  for (const title of listArticles()) {
    const size = fs.statSync(articlePath(title)).size;
    sizes.set(title, size);
    totalBytes += size;
  }
  const state = { sizes, totalBytes, writes: 0 };
  return async (title, normalizedText) => writeArticle(title, normalizedText, state);
}

export async function replaceArticleRange(title, start, end, pattern, replacement) {
  title = validateArticleTitle(title);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start + 1 > 10_000_000) throw new Error('替换区间必须是 1 至 10000000 个字符。');
  let old;
  try {
    old = await fsp.readFile(articlePath(title));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw articleUserError(`文章“${title}”不存在。`, { cause: err });
    throw err;
  }
  const text = normalizeArticleText(old, 'utf-8');
  const chars = [...compactArticleText(text)];
  if (end > chars.length) throw new Error(`文章只有 ${chars.length} 个字符，区间超出范围。`);
  let regex; try { regex = new RegExp(pattern, 'gu'); } catch (err) { throw new Error(`正则表达式无效：${err.message}`); }
  const selected = chars.slice(start - 1, end).join('').replace(regex, replacement ?? '');
  const compactPositions = [];
  const rawChars = [...text];
  for (let index = 0, compact = 0; index < rawChars.length; index++) {
    const char = rawChars[index];
    if (char !== '\n') { compactPositions[compact] = index; compact++; }
  }
  const rawStart = compactPositions[start - 1];
  const rawEnd = compactPositions[end - 1] + 1;
  rawChars.splice(rawStart, rawEnd - rawStart, ...[...selected]);
  return saveArticle(title, rawChars.join(''), 'utf-8');
}

export async function deleteArticle(title) {
  try {
    await fsp.rm(articlePath(title));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw articleUserError(`文章“${title}”不存在。`, { cause: err });
    throw err;
  }
  invalidateArticleView(title);
  const { removeArticleFromAllCategories } = await import('./articleCategories.js');
  await removeArticleFromAllCategories(title);
  return title;
}
