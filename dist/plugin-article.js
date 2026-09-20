import { randomInt } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql';
import compressing from 'compressing';
import { bot, consql } from './bot.js';
import { databaseConfig } from './config.js';
import { runMysqlTransaction } from './mysqlTransaction.js';
import { Structs } from 'node-napcat-ts';
import { isArticleAdmin, parseArticleCommand, extractDirectArticleText, getArticleHelp, ARTICLE_ADMIN_HELP } from './articleCommands.js';
import { saveArticle, createArticleBatchWriter, replaceArticleRange, deleteArticle, renameArticle, validateArticleTitle, resolveArticleTitle, normalizeArticleText, listArticles, scanArticleMetadata, removeArticleIndexFile } from './articleStorage.js';
import { addArticleCategory, removeArticleCategory, renameArticleCategory, categoryStatus, validateCategoryName, listCategories, listCategoryArticles } from './articleCategories.js';
import { addArticleCategoryRecord, listArticleCategoryDifficulty, removeArticleCategoryRecord, removeArticleCatalog, renameArticleCategoryRecord, setArticleCategoryDifficulty, syncArticleDifficultyCatalog, upsertArticleCatalog } from './articleDifficultyCatalog.js';
import { articleBatchErrorMessage, toArticleUserMessage } from './articleErrors.js';

const deleteTokens = new Map();
function queryConnection(connection, sql, values = []) {
  return new Promise((resolve, reject) => connection.query(sql, values, (error, rows) => error ? reject(error) : resolve(rows)));
}
syncArticleDifficultyCatalog(
  consql,
  new Set(listArticles({ sort: false })),
  scanArticleMetadata,
  listCategories().map(category => ({ category, titles: listCategoryArticles(category) }))
).catch(error => console.error('[plugin-article] difficulty catalog sync failed:', error.message || error));
function articleEventContext(e) {
  return {
    messageId: e.message_id,
    messageType: e.message_type,
    subType: e.sub_type,
    userId: e.sender?.user_id ?? e.user_id,
    groupId: e.group_id
  };
}

async function send(e, value) {
  const text = String(value);
  console.log('[plugin-article] sending reply', { ...articleEventContext(e), length: text.length, preview: text.slice(0, 120) });
  try {
    const result = await e.quick_action([Structs.text(text)]);
    console.log('[plugin-article] reply sent', articleEventContext(e));
    return result;
  } catch (err) {
    console.error('[plugin-article] reply failed', { ...articleEventContext(e), error: err?.message || String(err) });
    throw err;
  }
}

async function sendCategoryList(e) {
  const categories = categoryStatus().map(row => row.category);
  console.log('[plugin-article] category names prepared', { ...articleEventContext(e), categories: categories.length });
  return send(e, categories.length ? `当前分类：\n${categories.join('\n')}` : '暂无分类。');
}
const MAX_ARCHIVE_BYTES = 512 * 1024 ** 2;
const MAX_ARCHIVE_FILES = 20_000;
const MAX_ARCHIVE_TEXT_BYTES = 2 * 1024 ** 3;
function fileSegment(message) { return message?.find(x => x?.type === 'file') || null; }

function createBatchProgressReporter(e) {
  let lastSentAt = 0;
  let lastProcessed = -1;
  let lastPhase = null;
  return async ({ phase, processed = 0, total = 0, success = 0, skipped = 0, force = false }) => {
    const now = Date.now();
    if (phase !== lastPhase) force = true;
    if (!force && processed !== total && processed - lastProcessed < 500 && now - lastSentAt < 30_000) return;
    lastSentAt = now;
    lastProcessed = processed;
    lastPhase = phase;
    let text;
    if (phase === '解压') text = `批量上传：压缩包已解压，共 ${total} 个文件，开始校验。`;
    else if (phase === '校验') text = `批量上传校验中：已检查 ${processed}/${total} 个文件，合格 ${success} 篇，跳过 ${skipped} 个。`;
    else if (phase === '上传') text = `批量上传进行中：已处理 ${processed}/${total} 个文件，成功 ${success} 篇，跳过 ${skipped} 个。`;
    else text = `批量上传：${phase}`;
    try { await send(e, text); }
    catch (err) { console.error('[plugin-article] batch progress reply failed', { ...articleEventContext(e), error: err?.message || String(err) }); }
  };
}

async function renameArticleReferences(oldTitle, newTitle) {
  return runMysqlTransaction(() => mysql.createConnection(databaseConfig), async query => {
    const progressCollision = await query('select qqid from article_progress where title = ? limit 1', [newTitle]);
    if (progressCollision.length) throw new Error(`新文章标题“${newTitle}”已有用户进度记录，无法重命名。`);
    await query('update article_progress set title = ? where title = ?', [newTitle, oldTitle]);
    await query('update article_user_settings set current_title = ? where current_title = ?', [newTitle, oldTitle]);
    await query('update article_user_settings set last_title = ? where last_title = ?', [newTitle, oldTitle]);
    await query('update article_catalog set title = ? where title = ?', [newTitle, oldTitle]);
    await query('update article_category_members set title = ? where title = ?', [newTitle, oldTitle]);
    await query('insert into article_catalog_state (singleton_id, revision) values (1, 1) on duplicate key update revision = revision + 1');
  });
}

async function findUploadFile(e, extension) {
  let file = fileSegment(e.message);
  let sourceType = e.message_type;
  if (!file) {
    const reply = e.message?.find(x => x?.type === 'reply');
    if (reply) {
      const source = await bot.get_msg({ message_id: reply.data.id });
      file = fileSegment(source?.message);
      sourceType = source?.message_type || sourceType;
    }
  }
  if (!file) throw new Error('请在消息中附加 txt 文件，或引用包含 txt 文件的消息。');
  const filename = String(file.data?.file || '');
  if (!filename.toLowerCase().endsWith(extension)) throw new Error(`上传文件必须是 ${extension}。`);
  const fileSize = Number(file.data?.file_size);
  if (Number.isFinite(fileSize) && fileSize > MAX_ARCHIVE_BYTES) throw new Error('上传文件不能超过 512 MiB。');
  const getFileUrl = sourceType === 'group' ? bot.get_group_file_url.bind(bot) : bot.get_private_file_url.bind(bot);
  const info = await getFileUrl({ file_id: file.data?.file_id });
  if (!info?.url) throw new Error('无法获取文章文件下载地址。');
  const response = await fetch(info.url);
  if (!response.ok) throw new Error(`文章文件下载失败（HTTP ${response.status}）。`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error('上传文件不能超过 512 MiB。');
  return { filename, buffer };
}

async function walkFiles(directory) {
  const result = [];
  async function visit(current) {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) result.push(target);
      else throw new Error('压缩包中不允许包含软链接或特殊文件。');
    }
  }
  await visit(directory);
  return result;
}

async function batchUpload(category, archive, onProgress = async () => {}) {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'qqbot-article-'));
  try {
    await compressing.zip.uncompress(archive.buffer, temporary);
    const files = await walkFiles(temporary);
    if (files.length > MAX_ARCHIVE_FILES) throw new Error(`压缩包内文件不能超过 ${MAX_ARCHIVE_FILES} 个。`);
    await onProgress({ phase: '解压', total: files.length, force: true });
    const entries = [], skipped = [];
    const titles = new Set();
    const existingTitles = new Set(listArticles({ sort: false }));
    let totalBytes = 0;
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const relative = path.relative(temporary, file);
      if (!file.toLowerCase().endsWith('.txt')) {
        skipped.push({ file: relative, reason: '不是 txt 文件' });
        await onProgress({ phase: '校验', processed: index + 1, total: files.length, success: entries.length, skipped: skipped.length });
        continue;
      }
      let title, buffer;
      try {
        title = validateArticleTitle(path.basename(file, path.extname(file)));
        if (titles.has(title)) throw new Error(`清理标题后与其他文件重复：“${title}”`);
        if (existingTitles.has(title)) throw new Error(`文章已存在，自动跳过：“${title}”`);
        const stat = await fsp.stat(file);
        totalBytes += stat.size;
        if (totalBytes > MAX_ARCHIVE_TEXT_BYTES) throw new Error('解压后的正文总大小超过 2 GiB');
        buffer = await fsp.readFile(file);
        const text = normalizeArticleText(buffer);
        titles.add(title);
        entries.push({ title, text });
      } catch (err) {
        skipped.push({ file: relative, reason: articleBatchErrorMessage(err) });
      }
      await onProgress({ phase: '校验', processed: index + 1, total: files.length, success: entries.length, skipped: skipped.length });
    }
    if (!entries.length) throw new Error('压缩包中没有 txt 文件。');
    const saveBatchArticle = await createArticleBatchWriter();
    const validationSkipped = skipped.length;
    const results = [];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      try {
        const result = await saveBatchArticle(entry.title, entry.text);
        await upsertArticleCatalog(consql, result);
        await addArticleCategory(category, entry.title);
        await addArticleCategoryRecord(consql, category, entry.title);
        results.push(result);
      } catch (err) { skipped.push({ file: `${entry.title}.txt`, reason: articleBatchErrorMessage(err) }); }
      await onProgress({ phase: '上传', processed: validationSkipped + index + 1, total: files.length, success: results.length, skipped: skipped.length });
    }
    return { results, skipped };
  } finally { await fsp.rm(temporary, { recursive: true, force: true }).catch(() => {}); }
}

async function handleAdmin(e, command) {
  if (!isArticleAdmin(e.sender?.user_id ?? e.user_id)) return;
  const args = command.args;
  if (command.action === 'admin-help') return send(e, ARTICLE_ADMIN_HELP);
  if (command.action === 'category-help') return send(e, '分类管理：-管 分类 添加/删除 <分类名> <文章标题>；-管 分类 重命名 <旧分类名> <新分类名>；-管 分类 列表');
  if (command.action === 'category-list') {
    if (args.length) throw new Error('格式：-管 分类 列表');
    return sendCategoryList(e);
  }
  if (command.action === 'category-difficulty-list') {
    if (args.length) throw new Error('格式：-管 分类 难度列表');
    const rows = await listArticleCategoryDifficulty(consql);
    return send(e, rows.length ? `难度取样分类：\n${rows.map(row => `${row.category}（${row.difficulty_enabled ? '启用' : '停用'}，${row.article_count}篇）`).join('\n')}` : '暂无分类。');
  }
  if (['category-difficulty-enable', 'category-difficulty-disable', 'category-difficulty-view'].includes(command.action)) {
    if (args.length !== 1) throw new Error(`格式：-管 分类 ${command.action === 'category-difficulty-view' ? '难度查看' : command.action.endsWith('enable') ? '难度启用' : '难度停用'} <分类名>`);
    const category = validateCategoryName(args[0]);
    if (command.action === 'category-difficulty-view') {
      const rows = (await listArticleCategoryDifficulty(consql)).filter(row => row.category === category);
      if (!rows.length) throw new Error(`分类“${category}”不存在。`);
      const row = rows[0];
      return send(e, `分类“${category}”：难度取样${row.difficulty_enabled ? '启用' : '停用'}，${row.article_count}篇。`);
    }
    await setArticleCategoryDifficulty(consql, category, command.action === 'category-difficulty-enable');
    return send(e, `分类“${category}”已${command.action === 'category-difficulty-enable' ? '加入' : '移出'}难度发文取样池。`);
  }
  if (command.action === 'category-rename') {
    if (args.length !== 2) throw new Error('格式：-管 分类 重命名 <旧分类名> <新分类名>');
    const result = await renameArticleCategory(args[0], args[1]);
    await renameArticleCategoryRecord(consql, result.oldCategory, result.newCategory);
    return send(e, `分类“${result.oldCategory}”已重命名为“${result.newCategory}”。`);
  }
  if (command.action === 'category-add' || command.action === 'category-remove') {
    if (args.length < 2) throw new Error(`格式：-管 分类 ${command.action === 'category-add' ? '添加' : '删除'} <分类名> <文章标题>`);
    const category = validateCategoryName(args[0]), title = resolveArticleTitle(args.slice(1).join(' '));
    const result = command.action === 'category-add' ? await addArticleCategory(category, title) : await removeArticleCategory(category, title);
    if (command.action === 'category-add') await addArticleCategoryRecord(consql, category, title);
    else await removeArticleCategoryRecord(consql, category, title);
    return send(e, command.action === 'category-add' ? `文章“${result.title}”已${result.existed ? '在' : '加入'}分类“${result.category}”。` : `文章“${result.title}”已从分类“${result.category}”移除。`);
  }
  if (command.action === 'article-rename') {
    if (args.length !== 2) throw new Error('格式：-管 重命名 <旧标题> <新标题>');
    const oldTitle = resolveArticleTitle(args[0]), newTitle = validateArticleTitle(args[1]);
    const filesystemRename = await renameArticle(oldTitle, newTitle);
    let databaseRenamed = false;
    try {
      await renameArticleReferences(oldTitle, newTitle);
      databaseRenamed = true;
    } catch (err) {
      if (databaseRenamed) {
        try { await renameArticleReferences(newTitle, oldTitle); } catch (rollbackError) { console.warn('文章重命名数据库回滚失败:', rollbackError.message || rollbackError); }
      }
      try { await renameArticle(newTitle, oldTitle); } catch (rollbackError) { console.warn('文章重命名文件回滚失败:', rollbackError.message || rollbackError); }
      throw err;
    }
    return send(e, `文章“${filesystemRename.oldTitle}”已重命名为“${filesystemRename.newTitle}”。`);
  }
  if (command.action === 'upload') {
    if (args.length < 2) throw new Error('格式：-管 传 <分类> <文章标题>');
    const category = validateCategoryName(args[0]), title = validateArticleTitle(args.slice(1).join(' '));
    const result = await saveArticle(title, (await findUploadFile(e, '.txt')).buffer);
    await upsertArticleCatalog(consql, result);
    await addArticleCategory(category, title);
    await addArticleCategoryRecord(consql, category, title);
    return send(e, `文章“${result.title}”上传成功，共 ${result.chars} 字，已加入分类“${category}”。`);
  }
  if (command.action === 'batch-upload') {
    if (args.length !== 1) throw new Error('格式：-管 批量传 <分类>，请附加 zip 压缩包。');
    const category = validateCategoryName(args[0]);
    await send(e, '批量上传已开始，正在下载压缩包……');
    const reporter = createBatchProgressReporter(e);
    const { results, skipped } = await batchUpload(category, await findUploadFile(e, '.zip'), reporter);
    if (!results.length) throw new Error(`压缩包中没有可上传的 txt 文件${skipped.length ? `：${skipped[0].reason}` : ''}`);
    const details = skipped.length ? `\n已跳过 ${skipped.length} 个文件：\n${skipped.slice(0, 20).map(item => `${item.file}（${item.reason}）`).join('\n')}${skipped.length > 20 ? '\n其余失败项已省略。' : ''}` : '';
    return send(e, `批量上传完成：成功 ${results.length} 篇，已加入分类“${category}”；跳过 ${skipped.length} 个文件。${details}`);
  }
  if (command.action === 'replace') {
    if (args.length < 3) throw new Error('格式：-管 改 <起点> <终点> <文章标题>，下一行填写正则表达式。');
    const lines = String(e.raw_message || '').split(/\r?\n/);
    if (lines.length < 2) throw new Error('请在第二行填写正则表达式。');
    const result = await replaceArticleRange(resolveArticleTitle(args.slice(2).join(' ')), Number(args[0]), Number(args[1]), lines[1], lines.slice(2).join('\n'));
    await upsertArticleCatalog(consql, result);
    return send(e, `文章“${result.title}”替换成功，共 ${result.chars} 字。`);
  }
  if (command.action === 'delete') {
    if (!args.length) throw new Error('格式：-管 删 <文章标题>');
    const title = resolveArticleTitle(args.join(' '));
    const token = String(randomInt(100000, 1000000));
    deleteTokens.set(`${e.sender.user_id}:${token}`, { title, expires: Date.now() + 300000 });
    return send(e, `请在 5 分钟内发送“-管 确认 ${token}”删除文章“${title}”。`);
  }
  if (command.action === 'confirm-delete') {
    const key = `${e.sender.user_id}:${args[0]}`, pending = deleteTokens.get(key);
    if (!pending || pending.expires < Date.now()) { deleteTokens.delete(key); throw new Error('确认码不存在或已过期。'); }
    deleteTokens.delete(key);
    const rows = await queryConnection(consql, 'select index_key from article_catalog where title = ? limit 1', [pending.title]);
    const indexKey = rows[0]?.index_key || null;
    await deleteArticle(pending.title);
    await removeArticleCatalog(consql, pending.title);
    if (indexKey) {
      const references = await queryConnection(consql, 'select count(*) as count from article_catalog where index_key = ?', [indexKey]);
      if (!Number(references[0]?.count || 0)) await removeArticleIndexFile(indexKey);
    }
    return send(e, `文章“${pending.title}”已删除。`);
  }
}

bot.on('message', async e => {
  try {
    const directText = extractDirectArticleText(e.message);
    const command = parseArticleCommand(directText);
    console.log('[plugin-article] message received', { ...articleEventContext(e), text: directText.slice(0, 200), command });
    if (!command) return;
    if (command.action === 'category-list') return await sendCategoryList(e);
    if (command.action === 'help') return await send(e, getArticleHelp(command.args));
    const isAdmin = isArticleAdmin(e.sender?.user_id ?? e.user_id);
    console.log('[plugin-article] command parsed', { ...articleEventContext(e), action: command.action, args: command.args, isAdmin });
    if (['upload', 'batch-upload', 'replace', 'article-rename', 'delete', 'confirm-delete', 'admin-help', 'category-help', 'category-list', 'category-add', 'category-remove', 'category-rename', 'category-difficulty-list', 'category-difficulty-view', 'category-difficulty-enable', 'category-difficulty-disable'].includes(command.action)) return await handleAdmin(e, command);
  } catch (err) {
    const isAdmin = isArticleAdmin(e.sender?.user_id ?? e.user_id);
    console.error('[plugin-article] command failed', { ...articleEventContext(e), isAdmin, error: err?.message || String(err), stack: err?.stack });
    if (isAdmin) {
      try { await send(e, `发文管理失败：${toArticleUserMessage(err, '发文管理失败，请稍后重试。')}`); }
      catch (replyError) { console.error('[plugin-article] error reply failed', { ...articleEventContext(e), error: replyError?.message || String(replyError) }); }
    }
  }
});
