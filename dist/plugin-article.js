import { randomInt } from 'node:crypto';
import { bot } from './bot.js';
import { Structs } from 'node-napcat-ts';
import { isArticleAdmin, parseArticleCommand, extractDirectArticleText, ARTICLE_HELP } from './articleCommands.js';
import { saveArticle, listArticles, replaceArticleRange, deleteArticle, validateArticleTitle } from './articleStorage.js';

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

async function handleList(e, command) {
  let names = listArticles();
  if (command.keyword) names = names.filter(name => name.includes(command.keyword));
  if (!names.length) return send(e, '暂无文章。');
  const page = Math.max(1, command.page || 1), size = 50, pages = Math.ceil(names.length / size);
  return send(e, `文章列表（${page}/${pages}，共 ${names.length} 篇）\n${names.slice((page - 1) * size, page * size).join('\n')}`);
}

bot.on('message', async e => {
  try {
    const command = parseArticleCommand(extractDirectArticleText(e.message));
    if (!command) return;
    if (command.action === 'help') return send(e, ARTICLE_HELP);
    if (command.action === 'list') return handleList(e, command);
    if (['upload', 'replace', 'delete', 'confirm-delete', 'admin-help'].includes(command.action)) return handleAdmin(e, command);
  } catch (err) { if (isArticleAdmin(e.sender?.user_id)) send(e, `发文管理失败：${err.message}`); }
});
