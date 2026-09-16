import { bot, consql } from './bot.js';
import { Structs } from 'node-napcat-ts';
import { parseArticleCommand, extractDirectArticleText } from './articleCommands.js';
import { getArticleSettings, selectArticle, setSegmentLength, getProgress, setProgress, readArticle, clampProgress, searchArticle } from './articleUser.js';
import { parseSegmentArguments, orderedSegment, randomParagraph, randomCharacters } from './articleModes.js';
import { formatArticleMessage } from './articleMessage.js';
import { listArticles } from './articleStorage.js';

const send = (e, value) => e.quick_action([Structs.text(String(value))]);
const userId = e => String(e.sender?.user_id ?? e.user_id);
const triggerName = e => String(e.sender?.card || e.sender?.nickname || e.sender?.user_id || '未知用户');

async function list(e, command) {
  let names = listArticles();
  if (command.keyword) names = names.filter(name => name.includes(command.keyword));
  if (!names.length) return send(e, '暂无文章。');
  const page = Math.max(1, command.page || 1), size = 50;
  return send(e, `文章列表（${page}/${Math.max(1, Math.ceil(names.length / size))}，共 ${names.length} 篇）\n${names.slice((page - 1) * size, page * size).join('\n')}`);
}

async function progress(e, args) {
  const settings = await getArticleSettings(consql, userId(e));
  if (!settings.current_title) return send(e, '尚未选择文章，请先发送“》选 <标题>”。');
  const title = settings.current_title, body = await readArticle(title), length = [...body].length;
  const oldPosition = await getProgress(consql, userId(e), title);
  const expression = args.join(' ').trim();
  let position = oldPosition;
  if (expression) {
    const match = expression.match(/^([+=-])(\d+)$/);
    if (!match) throw new Error('格式：》进、》进 +500、》进 -500 或 》进 =12345。');
    const value = Number(match[2]);
    position = match[1] === '+' ? oldPosition + value : match[1] === '-' ? oldPosition - value : value;
    position = clampProgress(position, length);
    await setProgress(consql, userId(e), title, position);
  }
  const percent = length ? (position * 100 / length).toFixed(2) : '100.00';
  return send(e, `文章：${title}\n进度：${position}/${length} 字（${percent}%）`);
}

async function search(e, args) {
  const raw = args.join(' '), split = raw.split(/\s+于\s+/), settings = await getArticleSettings(consql, userId(e));
  let keyword = split[0].trim(), title = split[1]?.trim() || settings.current_title;
  if (!title) return send(e, '尚未选择文章，请先选择文章或使用“于 <标题>”。');
  let page = 1;
  const pageMatch = keyword.match(/\s+(\d+)$/);
  if (pageMatch) { page = Number(pageMatch[1]); keyword = keyword.slice(0, pageMatch.index).trim(); }
  const result = searchArticle(await readArticle(title), keyword, page);
  if (!result.positions.length) return send(e, `文章“${title}”中没有找到“${keyword}”。`);
  return send(e, `文章：${title}，共找到 ${result.positions.length} 处（${result.page}/${result.totalPages}）\n` + result.items.map(item => `第 ${item.position} 字：${item.context}`).join('\n'));
}

async function articleMode(e, mode, args) {
  const settings = await getArticleSettings(consql, userId(e));
  const parsed = parseSegmentArguments(args, Number(settings.segment_length) || 100);
  const title = parsed.title || settings.current_title;
  if (!title) throw new Error('尚未选择文章，请先发送“》选 <标题>”或在命令后附文章标题。');
  const body = await readArticle(title), chars = [...body];
  await setSegmentLength(consql, userId(e), parsed.length);
  let segment;
  if (mode === 'ordered') {
    const position = await getProgress(consql, userId(e), title);
    segment = orderedSegment(chars, position, parsed.length);
    await setProgress(consql, userId(e), title, segment.nextPosition);
  } else if (mode === 'paragraph') segment = randomParagraph(chars, parsed.length);
  else segment = randomCharacters(chars, parsed.length);
  return send(e, formatArticleMessage(segment.text, { title, trigger: triggerName(e) }));
}

bot.on('message', async e => {
  try {
    const command = parseArticleCommand(extractDirectArticleText(e.message));
    if (!command) return;
    if (command.action === 'list') return list(e, command);
    if (command.action === '选' || command.action === '选择文章') {
      if (!command.args?.length) throw new Error('格式：》选 <文章标题>');
      return send(e, `已选择文章“${await selectArticle(consql, userId(e), command.args.join(' '))}”。`);
    }
    if (command.action === '进' || command.action === '文章进度') return progress(e, command.args || []);
    if (command.action === '搜' || command.action === '文内搜索') {
      if (!command.args?.length) throw new Error('格式：》搜 <关键词> [页码] [于 <文章标题>]');
      return search(e, command.args);
    }
    if (command.action === '顺' || command.action === '顺序发文') return articleMode(e, 'ordered', command.args);
    if (command.action === '随' || command.action === '随机段落发文') return articleMode(e, 'paragraph', command.args);
    if (command.action === '乱' || command.action === '随机选字发文') return articleMode(e, 'characters', command.args);
  } catch (err) { send(e, `发文操作失败：${err.message}`); }
});
