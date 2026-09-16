import { randomInt } from 'node:crypto';
import { bot } from './bot.js';
import { Structs } from 'node-napcat-ts';
import { isArticleAdmin, parseArticleCommand, extractDirectArticleText, ARTICLE_HELP } from './articleCommands.js';
import { saveArticle, replaceArticleRange, deleteArticle, validateArticleTitle } from './articleStorage.js';
import { syncDifficultyMap, getDifficultyMapStatus, cancelDifficultyMapSync } from './articleMap.js';

const deleteTokens = new Map();
const send = (e, value) => e.quick_action([Structs.text(String(value))]);
function fileSegment(message) { return message?.find(x => x?.type === 'file') || null; }

async function findUploadFile(e) {
  let file = fileSegment(e.message);
  if (!file) {
    const reply = e.message?.find(x => x?.type === 'reply');
    if (reply) file = fileSegment((await bot.get_msg({ message_id: reply.data.id }))?.message);
  }
  if (!file) throw new Error('请在消息中附加 txt 文件，或引用包含 txt 文件的消息。');
  const filename = String(file.data?.file || '');
  if (!filename.toLowerCase().endsWith('.txt')) throw new Error('文章文件必须是 .txt。');
  const info = await bot.get_file({ file_id: file.data?.file_id });
  if (!info?.base64) throw new Error('无法下载文章文件。');
  return Buffer.from(info.base64, 'base64');
}

async function handleAdmin(e, command) {
  if (!isArticleAdmin(e.sender?.user_id)) return;
  const args = command.args;
  if (command.action === 'admin-help') return send(e, ARTICLE_HELP);
  if (command.action === 'map-status') {
    const status = getDifficultyMapStatus();
    if (!status.running) return send(e, '难度地图当前没有同步任务。');
    return send(e, `难度地图同步中：${status.processed}/${status.total} 篇，已生成 ${status.records} 条记录${status.cancelRequested ? '，等待取消' : ''}。`);
  }
  if (command.action === 'map-cancel') return send(e, cancelDifficultyMapSync() ? '已请求取消难度地图同步。' : '当前没有正在运行的难度地图任务。');
  if (command.action === 'map-sync') {
    if (command.args?.length) throw new Error('格式：》管 索');
    send(e, '难度地图同步已开始。');
    const result = await syncDifficultyMap();
    return send(e, result.cancelled ? '难度地图同步已取消，已提交的旧地图保持不变。' : `难度地图同步完成，共 ${result.records.length} 条记录，变更 ${result.changed} 篇文章。`);
  }
  if (command.action === 'upload') {
    if (!args.length) throw new Error('格式：》管 传 <文章标题>');
    const result = await saveArticle(validateArticleTitle(args.join(' ')), await findUploadFile(e));
    return send(e, `文章“${result.title}”上传成功，共 ${result.chars} 字，${result.bytes} 字节。`);
  }
  if (command.action === 'replace') {
    if (args.length < 3) throw new Error('格式：》管 改 <起点> <终点> <文章标题>，下一行填写正则表达式。');
    const lines = String(e.raw_message || '').split(/\r?\n/);
    if (lines.length < 2) throw new Error('请在第二行填写正则表达式。');
    const result = await replaceArticleRange(args.slice(2).join(' '), Number(args[0]), Number(args[1]), lines[1], lines.slice(2).join('\n'));
    return send(e, `文章“${result.title}”替换成功，共 ${result.chars} 字。`);
  }
  if (command.action === 'delete') {
    if (!args.length) throw new Error('格式：》管 删 <文章标题>');
    const title = validateArticleTitle(args.join(' '));
    const token = String(randomInt(100000, 1000000));
    deleteTokens.set(`${e.sender.user_id}:${token}`, { title, expires: Date.now() + 300000 });
    return send(e, `请在 5 分钟内发送“》管 确认 ${token}”删除文章“${title}”。`);
  }
  if (command.action === 'confirm-delete') {
    const key = `${e.sender.user_id}:${args[0]}`, pending = deleteTokens.get(key);
    if (!pending || pending.expires < Date.now()) { deleteTokens.delete(key); throw new Error('确认码不存在或已过期。'); }
    deleteTokens.delete(key); await deleteArticle(pending.title); return send(e, `文章“${pending.title}”已删除。`);
  }
}

bot.on('message', async e => {
  try {
    const command = parseArticleCommand(extractDirectArticleText(e.message));
    if (!command) return;
    if (command.action === 'help') return send(e, ARTICLE_HELP);
    if (['upload', 'replace', 'delete', 'confirm-delete', 'admin-help', 'map-sync', 'map-status', 'map-cancel'].includes(command.action)) return handleAdmin(e, command);
  } catch (err) { if (isArticleAdmin(e.sender?.user_id)) send(e, `发文管理失败：${err.message}`); }
});
