import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTICLE_DIR, articlePath, saveArticle, validateArticleTitle } from '../dist/articleStorage.js';
import { normalizeImportedTitle, parseTextListResponse, TEXT_LIST_URL, IMPORT_LIMIT } from './importer.js';

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_STATE_PATH = path.join(ARTICLE_DIR, 'import-batch-state.json');

export function parseBatchArgs(argv = []) {
  const options = { pageSize: DEFAULT_PAGE_SIZE, interval: DEFAULT_INTERVAL_MS, statePath: DEFAULT_STATE_PATH, overwrite: false, startPage: null, maxPages: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--overwrite') { options.overwrite = true; continue; }
    const match = arg.match(/^--(page-size|interval|state|start-page|max-pages)=(.+)$/u);
    if (!match) throw new Error(`未知参数：${arg}`);
    const [, name, raw] = match;
    if (name === 'state') options.statePath = path.resolve(raw);
    else {
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`参数 --${name} 必须是正整数。`);
      if (name === 'page-size' && value > IMPORT_LIMIT) throw new Error(`--page-size 不能超过 ${IMPORT_LIMIT}。`);
      if (name === 'interval') options.interval = value;
      if (name === 'page-size') options.pageSize = value;
      if (name === 'start-page') options.startPage = value;
      if (name === 'max-pages') options.maxPages = value;
    }
  }
  return options;
}

async function readState(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeState(file, state) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(state, null, 2), { flag: 'wx' }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

async function fetchPage(page, pageSize, signal) {
  const response = await fetch(TEXT_LIST_URL, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'qqbot-article-batch-import/1.0' },
    body: new URLSearchParams({ textName: '', minTextWordNum: '', maxTextWordNum: '', currentPage: String(page), pagesize: String(pageSize) })
  });
  if (!response.ok) throw new Error(`文本列表接口 HTTP ${response.status}`);
  const data = await response.json();
  if (data.error !== 0 || !Array.isArray(data.msg?.list)) throw new Error('文本列表接口返回格式异常。');
  return { total: Number(data.msg.total || data.total || 0), items: parseTextListResponse(data.msg) };
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function runBatchImport(options = {}, { signal } = {}) {
  options = { ...parseBatchArgs([]), ...options };
  const stateFile = path.resolve(options.statePath || DEFAULT_STATE_PATH);
  const old = await readState(stateFile);
  const pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
  const interval = options.interval ?? DEFAULT_INTERVAL_MS;
  let page = options.startPage || old?.nextPage || 1;
  const result = {
    total: old?.total || 0, pages: old?.pages || 0, imported: old?.imported || 0,
    skipped: old?.skipped || 0, failed: old?.failed || 0, bytes: old?.bytes || 0,
    nextPage: page, completed: false, updatedAt: new Date().toISOString()
  };
  const maxPages = options.maxPages || Infinity;
  let lastRequest = 0;
  while (result.pages < maxPages) {
    if (signal?.aborted) throw new Error('批量导入已取消。');
    const delay = interval - (Date.now() - lastRequest);
    if (lastRequest && delay > 0) await sleep(delay);
    const batch = await fetchPage(page, pageSize, signal);
    lastRequest = Date.now();
    result.total = batch.total || result.total;
    if (!batch.items.length) break;
    for (const [index, item] of batch.items.entries()) {
      const label = item.originalTitle || item.title || `第 ${index + 1} 篇`;
      try {
        const title = validateArticleTitle(normalizeImportedTitle(item.title));
        const target = articlePath(title);
        let exists = false;
        try { exists = (await fs.stat(target)).isFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (exists && !options.overwrite) { result.skipped++; console.log(`跳过已有：${title}`); continue; }
        if (!item.body) throw new Error('正文为空。');
        const saved = await saveArticle(title, item.body, 'utf-8');
        result.imported++; result.bytes += saved.bytes;
        console.log(`成功 ${result.imported}：${title}（${saved.bytes} 字节）`);
      } catch (error) {
        result.failed++;
        console.error(`失败：${label}：${error.message}`);
      }
    }
    result.pages++; result.nextPage = page + 1; result.updatedAt = new Date().toISOString();
    await writeState(stateFile, { ...result, pageSize, interval, overwrite: Boolean(options.overwrite) });
    console.log(`页面 ${page} 完成：累计成功 ${result.imported}，跳过 ${result.skipped}，失败 ${result.failed}，进度约 ${Math.min(result.nextPage - 1, Math.ceil(result.total / pageSize))}/${Math.ceil(result.total / pageSize) || '-'} 页。`);
    if (batch.items.length < pageSize || result.nextPage > Math.ceil(result.total / pageSize)) break;
    page++;
  }
  result.completed = result.total > 0 ? result.nextPage > Math.ceil(result.total / pageSize) : true;
  result.updatedAt = new Date().toISOString();
  await writeState(stateFile, { ...result, pageSize, interval, overwrite: Boolean(options.overwrite) });
  console.log(`批量导入${result.completed ? '完成' : '暂停'}：接口共 ${result.total || '-'} 篇，成功 ${result.imported}，跳过 ${result.skipped}，失败 ${result.failed}，${result.bytes} 字节。`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseBatchArgs(process.argv.slice(2));
    console.log(`批量导入开始：每页 ${options.pageSize} 篇，间隔 ${options.interval}ms，${options.overwrite ? '允许覆盖已有标题' : '跳过已有标题'}。`);
    await runBatchImport(options);
  } catch (error) { console.error(`批量导入失败：${error.message}`); process.exitCode = 1; }
}
