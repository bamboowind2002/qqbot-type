import { randomInt } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql';
import compressing from 'compressing';
import { bot } from './bot.js';
import { databaseConfig } from './config.js';
import { runMysqlTransaction } from './mysqlTransaction.js';
import { Structs } from 'node-napcat-ts';
import { isArticleAdmin, parseArticleCommand, extractDirectArticleText, ARTICLE_HELP } from './articleCommands.js';
import { saveArticle, replaceArticleRange, deleteArticle, renameArticle, validateArticleTitle, normalizeArticleText } from './articleStorage.js';
import { startDifficultyMapTask, getDifficultyMapTaskStatus, cancelDifficultyMapTask } from './articleMapManager.js';
import { renameDifficultyMapTitle } from './articleMap.js';
import { addArticleCategory, removeArticleCategory, renameArticleCategory, categoryStatus, validateCategoryName } from './articleCategories.js';

const deleteTokens = new Map();
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

async function renameArticleReferences(oldTitle, newTitle) {
  return runMysqlTransaction(() => mysql.createConnection(databaseConfig), async query => {
    const progressCollision = await query('select qqid from article_progress where title = ? limit 1', [newTitle]);
    if (progressCollision.length) throw new Error(`新文章标题“${newTitle}”已有用户进度记录，无法重命名。`);
    await query('update article_progress set title = ? where title = ?', [newTitle, oldTitle]);
    await query('update article_user_settings set current_title = ? where current_title = ?', [newTitle, oldTitle]);
    await query('update article_user_settings set last_title = ? where last_title = ?', [newTitle, oldTitle]);
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

async function batchUpload(category, archive) {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'qqbot-article-'));
  try {
    await compressing.zip.uncompress(archive.buffer, temporary);
    const files = await walkFiles(temporary);
    if (files.length > MAX_ARCHIVE_FILES) throw new Error(`压缩包内文件不能超过 ${MAX_ARCHIVE_FILES} 个。`);
    const entries = [], skipped = [];
    const titles = new Set();
    let totalBytes = 0;
    for (const file of files) {
      const relative = path.relative(temporary, file);
      if (!file.toLowerCase().endsWith('.txt')) { skipped.push({ file: relative, reason: '不是 txt 文件' }); continue; }
      let title, buffer;
      try {
        title = validateArticleTitle(path.basename(file, path.extname(file)));
        if (titles.has(title)) throw new Error(`清理标题后与其他文件重复：“${title}”`);
        const stat = await fsp.stat(file);
        totalBytes += stat.size;
        if (totalBytes > MAX_ARCHIVE_TEXT_BYTES) throw new Error('解压后的正文总大小超过 2 GiB');
        buffer = await fsp.readFile(file);
        normalizeArticleText(buffer);
      } catch (err) {
        skipped.push({ file: relative, reason: err.message });
        continue;
      }
      titles.add(title);
      entries.push({ title, buffer });
    }
    if (!entries.length) throw new Error('压缩包中没有 txt 文件。');
    const results = [];
    for (const entry of entries) {
      try {
        const result = await saveArticle(entry.title, entry.buffer);
        await addArticleCategory(category, entry.title);
        results.push(result);
      } catch (err) { skipped.push({ file: `${entry.title}.txt`, reason: err.message }); }
    }
    return { results, skipped };
  } finally { await fsp.rm(temporary, { recursive: true, force: true }).catch(() => {}); }
}

async function handleAdmin(e, command) {
  if (!isArticleAdmin(e.sender?.user_id ?? e.user_id)) return;
  const args = command.args;
  if (command.action === 'admin-help') return send(e, ARTICLE_HELP);
  if (command.action === 'category-help') return send(e, '分类管理：-管 分类 添加/删除 <分类名> <文章标题>；-管 分类 重命名 <旧分类名> <新分类名>；-管 分类 列表');
  if (command.action === 'category-list') {
    if (args.length) throw new Error('格式：-管 分类 列表');
    return sendCategoryList(e);
  }
  if (command.action === 'category-rename') {
    if (args.length !== 2) throw new Error('格式：-管 分类 重命名 <旧分类名> <新分类名>');
    const result = await renameArticleCategory(args[0], args[1]);
    return send(e, `分类“${result.oldCategory}”已重命名为“${result.newCategory}”。`);
  }
  if (command.action === 'category-add' || command.action === 'category-remove') {
    if (args.length < 2) throw new Error(`格式：-管 分类 ${command.action === 'category-add' ? '添加' : '删除'} <分类名> <文章标题>`);
    const category = validateCategoryName(args[0]), title = validateArticleTitle(args.slice(1).join(' '));
    const result = command.action === 'category-add' ? await addArticleCategory(category, title) : await removeArticleCategory(category, title);
    return send(e, command.action === 'category-add' ? `文章“${result.title}”已${result.existed ? '在' : '加入'}分类“${result.category}”。` : `文章“${result.title}”已从分类“${result.category}”移除。`);
  }
  if (command.action === 'article-rename') {
    if (args.length !== 2) throw new Error('格式：-管 重命名 <旧标题> <新标题>');
    const oldTitle = validateArticleTitle(args[0]), newTitle = validateArticleTitle(args[1]);
    if (getDifficultyMapTaskStatus().running) throw new Error('难度地图正在同步，请稍后再重命名文章。');
    const filesystemRename = await renameArticle(oldTitle, newTitle);
    let databaseRenamed = false;
    try {
      await renameArticleReferences(oldTitle, newTitle);
      databaseRenamed = true;
      await renameDifficultyMapTitle(oldTitle, newTitle);
    } catch (err) {
      if (databaseRenamed) {
        try { await renameArticleReferences(newTitle, oldTitle); } catch (rollbackError) { console.warn('文章重命名数据库回滚失败:', rollbackError.message || rollbackError); }
      }
      try { await renameArticle(newTitle, oldTitle); } catch (rollbackError) { console.warn('文章重命名文件回滚失败:', rollbackError.message || rollbackError); }
      throw err;
    }
    return send(e, `文章“${filesystemRename.oldTitle}”已重命名为“${filesystemRename.newTitle}”。`);
  }
  if (command.action === 'map-status') {
    const status = getDifficultyMapTaskStatus();
    if (!status.running) return send(e, '难度地图当前没有同步任务。');
    return send(e, `难度地图同步中：${status.processed}/${status.total} 篇，已生成 ${status.records} 条记录${status.cancelRequested ? '，等待取消' : ''}。`);
  }
  if (command.action === 'map-cancel') return send(e, cancelDifficultyMapTask() ? '已请求取消难度地图同步。' : '当前没有正在运行的难度地图任务。');
  if (command.action === 'map-sync') {
    if (command.args?.length) throw new Error('格式：-管 索');
    send(e, '难度地图同步已开始。');
    const result = await startDifficultyMapTask();
    return send(e, result.cancelled ? '难度地图同步已取消，已提交的旧地图保持不变。' : `难度地图同步完成，共 ${result.records.length} 条记录，变更 ${result.changed} 篇文章。`);
  }
  if (command.action === 'upload') {
    if (args.length < 2) throw new Error('格式：-管 传 <分类> <文章标题>');
    const category = validateCategoryName(args[0]), title = validateArticleTitle(args.slice(1).join(' '));
    const result = await saveArticle(title, (await findUploadFile(e, '.txt')).buffer);
    await addArticleCategory(category, title);
    return send(e, `文章“${result.title}”上传成功，共 ${result.chars} 字，已加入分类“${category}”。`);
  }
  if (command.action === 'batch-upload') {
    if (args.length !== 1) throw new Error('格式：-管 批量传 <分类>，请附加 zip 压缩包。');
    const category = validateCategoryName(args[0]);
    const { results, skipped } = await batchUpload(category, await findUploadFile(e, '.zip'));
    if (!results.length) throw new Error(`压缩包中没有可上传的 txt 文件${skipped.length ? `：${skipped[0].reason}` : ''}`);
    const details = skipped.length ? `\n已跳过 ${skipped.length} 个文件：\n${skipped.slice(0, 20).map(item => `${item.file}（${item.reason}）`).join('\n')}${skipped.length > 20 ? '\n其余失败项已省略。' : ''}` : '';
    return send(e, `批量上传完成：成功 ${results.length} 篇，已加入分类“${category}”；跳过 ${skipped.length} 个文件。${details}`);
  }
  if (command.action === 'replace') {
    if (args.length < 3) throw new Error('格式：-管 改 <起点> <终点> <文章标题>，下一行填写正则表达式。');
    const lines = String(e.raw_message || '').split(/\r?\n/);
    if (lines.length < 2) throw new Error('请在第二行填写正则表达式。');
    const result = await replaceArticleRange(args.slice(2).join(' '), Number(args[0]), Number(args[1]), lines[1], lines.slice(2).join('\n'));
    return send(e, `文章“${result.title}”替换成功，共 ${result.chars} 字。`);
  }
  if (command.action === 'delete') {
    if (!args.length) throw new Error('格式：-管 删 <文章标题>');
    const title = validateArticleTitle(args.join(' '));
    const token = String(randomInt(100000, 1000000));
    deleteTokens.set(`${e.sender.user_id}:${token}`, { title, expires: Date.now() + 300000 });
    return send(e, `请在 5 分钟内发送“-管 确认 ${token}”删除文章“${title}”。`);
  }
  if (command.action === 'confirm-delete') {
    const key = `${e.sender.user_id}:${args[0]}`, pending = deleteTokens.get(key);
    if (!pending || pending.expires < Date.now()) { deleteTokens.delete(key); throw new Error('确认码不存在或已过期。'); }
    deleteTokens.delete(key); await deleteArticle(pending.title); return send(e, `文章“${pending.title}”已删除。`);
  }
}

bot.on('message', async e => {
  try {
    const directText = extractDirectArticleText(e.message);
    const command = parseArticleCommand(directText);
    console.log('[plugin-article] message received', { ...articleEventContext(e), text: directText.slice(0, 200), command });
    if (!command) return;
    if (command.action === 'category-list') return sendCategoryList(e);
    if (command.action === 'help') return send(e, ARTICLE_HELP);
    const isAdmin = isArticleAdmin(e.sender?.user_id ?? e.user_id);
    console.log('[plugin-article] command parsed', { ...articleEventContext(e), action: command.action, args: command.args, isAdmin });
    if (['upload', 'batch-upload', 'replace', 'article-rename', 'delete', 'confirm-delete', 'admin-help', 'map-sync', 'map-status', 'map-cancel', 'category-help', 'category-list', 'category-add', 'category-remove', 'category-rename'].includes(command.action)) return await handleAdmin(e, command);
  } catch (err) {
    const isAdmin = isArticleAdmin(e.sender?.user_id ?? e.user_id);
    console.error('[plugin-article] command failed', { ...articleEventContext(e), isAdmin, error: err?.message || String(err), stack: err?.stack });
    if (isAdmin) await send(e, `发文管理失败：${err.message}`);
  }
});
