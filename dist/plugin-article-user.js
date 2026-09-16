import { bot, consql } from './bot.js';
import { Structs } from 'node-napcat-ts';
import { parseArticleCommand, extractDirectArticleText } from './articleCommands.js';
import { getArticleSettings, selectArticle, setSegmentLength, getProgress, setProgress, readArticle, clampProgress, searchArticle } from './articleUser.js';
import { parseSegmentArguments, parseRandomRange, orderedSegment, randomParagraph, randomCharacters } from './articleModes.js';
import { formatArticleMessage } from './articleMessage.js';
import { compileScoreCondition, getArticleSession, openArticleSession, closeArticleSession, sessionKey, parseScore, touchArticleSession } from './articleSession.js';
import { chooseDifficultySegment, normalizeDifficulty } from './articleDifficulty.js';
import { get_rank } from './rank.js';
import { readDifficultyMap } from './articleMap.js';
import { candidateCacheGet, candidateCachePut } from './articleCandidateCache.js';
import { isDifficultyMatch } from './articleDifficulty.js';
import crypto from 'node:crypto';
import { listArticles } from './articleStorage.js';
import { listCategoryArticles } from './articleCategories.js';

const send = (e, value) => e.quick_action([Structs.text(String(value))]);
const userId = e => String(e.sender?.user_id ?? e.user_id);
const triggerName = e => String(e.sender?.card || e.sender?.nickname || e.sender?.user_id || '未知用户');

async function list(e, command) {
  let names = command.category ? listCategoryArticles(command.category) : listArticles();
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
  const randomArgs = mode === 'characters' ? parseRandomRange(args || []) : { args: args || [], range: null };
  const split = randomArgs.args.join(' ').split(/\s*\|\s*/u);
  const parsed = parseSegmentArguments(split[0].trim().split(/\s+/).filter(Boolean), Number(settings.segment_length) || 100);
  const condition = split.length > 1 ? split.slice(1).join('|').trim() : '';
  const title = parsed.title || settings.current_title;
  if (!title) throw new Error('尚未选择文章，请先发送“》选 <标题>”或在命令后附文章标题。');
  const body = await readArticle(title), chars = [...body];
  await setSegmentLength(consql, userId(e), parsed.length);
  let segment;
  if (mode === 'ordered') {
    const position = await getProgress(consql, userId(e), title);
    if (position >= chars.length) throw new Error('这篇文章已经发完了。');
    segment = orderedSegment(chars, position, parsed.length);
  } else if (mode === 'paragraph') segment = randomParagraph(chars, parsed.length);
  else if (randomArgs.range) segment = randomCharacters(chars, parsed.length, Math.random, randomArgs.range.start - 1, randomArgs.range.end);
  else segment = randomCharacters(chars, parsed.length);
  const output = formatArticleMessage(segment.text, { title, trigger: triggerName(e) });
  const number = Number(output.match(/第(\d+)段/u)?.[1]);
  openArticleSession(sessionKey(e), { title, mode, length: parsed.length, startPosition: mode === 'ordered' ? (await getProgress(consql, userId(e), title)) : null, nextPosition: segment.nextPosition ?? null, segment: number, condition: compileScoreCondition(condition), conditionText: condition, body: body });
  return send(e, output);
}

async function difficultyMode(e, difficulty, args) {
  const settings = await getArticleSettings(consql, userId(e));
  const parsed = parseSegmentArguments(args, Number(settings.segment_length) || 100);
  const articles = [];
  for (const title of listArticles()) articles.push({ title, text: await readArticle(title) });
  const map = await readDifficultyMap();
  const previous = getArticleSession(sessionKey(e));
  const sameMode = previous?.mode === 'difficulty' && previous.length === parsed.length && previous.difficulty === normalizeDifficulty(difficulty);
  const recent = sameMode ? (previous.recentSegments || []) : [];
  const excluded = new Set(recent.map(item => `${item.title}:${item.start}`));
  let result = null;
  const byTitle = new Map(articles.map(article => [article.title, article]));
  const cachedCandidates = candidateCacheGet(parsed.length, difficulty).filter(cached => !excluded.has(`${cached.title}:${cached.start}`));
  for (const cached of cachedCandidates.sort(() => Math.random() - 0.5)) {
    const article = byTitle.get(cached.title);
    if (!article) continue;
    const chars = [...article.text];
    if (cached.start < 0 || cached.start + parsed.length > chars.length) continue;
    const text = chars.slice(cached.start, cached.start + parsed.length).join('');
    const [score, , rank, error] = get_rank(text);
    if (!error && isDifficultyMatch(score, difficulty)) { result = { title: cached.title, text, start: cached.start, score, rank }; break; }
  }
  if (!result) result = chooseDifficultySegment(articles, parsed.length, difficulty, get_rank, Math.random, () => Date.now(), map.records || [], excluded);
  if (!result && excluded.size) result = chooseDifficultySegment(articles, parsed.length, difficulty, get_rank, Math.random, () => Date.now(), map.records || []);
  if (!result) throw new Error('没有找到可用段落。');
  const revision = crypto.createHash('sha256').update(byTitle.get(result.title).text).digest('hex');
  candidateCachePut({ length: parsed.length, difficulty, title: result.title, revision, start: result.start, score: result.score });
  await setSegmentLength(consql, userId(e), parsed.length);
  const output = formatArticleMessage(result.text, { title: result.title, trigger: triggerName(e) });
  const number = Number(output.match(/第(\d+)段/u)?.[1]);
  const recentSegments = [...recent, { title: result.title, start: result.start }].slice(-20);
  openArticleSession(sessionKey(e), { title: result.title, mode: 'difficulty', difficulty: normalizeDifficulty(difficulty), length: parsed.length, startPosition: null, nextPosition: null, segment: number, condition: () => true, conditionText: '', body: result.text, recentSegments });
  return send(e, output);
}

async function continueSession(e, session, force = false) {
  touchArticleSession(session);
  if (session.mode === 'ordered') await setProgress(consql, userId(e), session.title, session.nextPosition);
  if (session.mode === 'difficulty') return difficultyMode(e, session.difficulty, [String(session.length)]);
  return articleMode(e, session.mode, [String(session.length), session.title]);
}

async function handleSessionCommand(e, command) {
  const key = sessionKey(e), session = getArticleSession(key);
  if (command.action === '停' || command.action === '结束发文') { closeArticleSession(key); return send(e, '当前发文会话已结束。'); }
  if (command.action === '自' || command.action === '设置自动续段') {
    if (!session) throw new Error('当前没有发文会话。');
    const conditionText = (command.args || []).join(' ').trim();
    session.condition = compileScoreCondition(conditionText); session.conditionText = conditionText; touchArticleSession(session);
    return send(e, conditionText ? `自动续段条件已设置：${conditionText}` : '已恢复无条件自动续段。');
  }
  if (command.action === '下' || command.action === '下一段') {
    if (!session) throw new Error('当前没有发文会话。');
    return continueSession(e, session, true);
  }
  if (command.action === '上' || command.action === '上一段') {
    if (!session || session.mode !== 'ordered') throw new Error('只有顺序发文支持回到上一段。');
    const position = Math.max(0, session.startPosition - session.length);
    await setProgress(consql, userId(e), session.title, position);
    closeArticleSession(key);
    return articleMode(e, 'ordered', [String(session.length), session.title]);
  }
}

async function handleScore(e) {
  const score = parseScore(e.raw_message);
  if (!score) return;
  const session = getArticleSession(sessionKey(e));
  if (!session || score.segment !== session.segment || !session.condition(score.metrics)) return;
  await continueSession(e, session);
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
    if (command.action === '难度发文') {
      if (!command.args?.length) throw new Error('格式：》难度发文 <淼|水|易|普|难|虐|爆表> [字数]');
      const difficulty = command.args[0];
      return difficultyMode(e, difficulty, command.args.slice(1));
    }
    const difficultyAliases = { '淼': '淼', '水': '水', '易': '易', '普': '普', '难': '难', '虐': '虐', '爆': '爆表' };
    if (difficultyAliases[command.action]) return difficultyMode(e, difficultyAliases[command.action], command.args);
    if (['上', '上一段', '下', '下一段', '停', '结束发文', '自', '设置自动续段'].includes(command.action)) return handleSessionCommand(e, command);
    return;
  } catch (err) { send(e, `发文操作失败：${err.message}`); }
});

bot.on('message', async e => {
  if (String(e.raw_message || '').startsWith('》')) return;
  try { await handleScore(e); } catch (err) { console.warn('处理发文成绩失败：', err.message); }
});
