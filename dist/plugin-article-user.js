import { bot, consql } from './bot.js';
import { Structs } from 'node-napcat-ts';
import { ARTICLE_PREFIX, parseArticleCommand, extractDirectArticleText } from './articleCommands.js';
import { getArticleSettings, saveLastArticleConfig, saveLastArticleCondition, selectArticle, setSegmentLength, getProgress, getProgressState, setProgress, saveOrderedProgress, readArticle, clampProgress, searchArticle } from './articleUser.js';
import { parseSegmentArguments, parseRandomRange, orderedSegment, randomParagraph, randomLines } from './articleModes.js';
import { formatArticleMessage } from './articleMessage.js';
import { articleRevision, compileScoreCondition, getArticleSession, openArticleSession, closeArticleSession, sessionKey, parseScore, touchArticleSession } from './articleSession.js';
import { isOrderedSessionCurrent, orderedLockKey, previousOrderedRange, resolveOrderedRepeat, withOrderedLock } from './articleOrdered.js';
import { DIFFICULTY_RANGES, isDifficultyMatch, normalizeDifficulty } from './articleDifficulty.js';
import { get_rank } from './rank.js';
import { readDifficultyMap } from './articleMap.js';
import { candidateCacheGet, candidateCachePut } from './articleCandidateCache.js';
import { listArticles, readArticleViews } from './articleStorage.js';
import { listCategoryArticles } from './articleCategories.js';

const send = (e, value) => e.quick_action([Structs.text(String(value))]);
const userId = e => String(e.sender?.user_id ?? e.user_id);
const triggerName = e => String(e.sender?.card || e.sender?.nickname || e.sender?.user_id || '未知用户');

async function deliverOrderedSegment(e, { title, body, start, end, length, conditionText = '', persist = true }) {
  const text = [...body].slice(start, end).join('');
  const output = formatArticleMessage(text, { title, trigger: triggerName(e) });
  const number = Number(output.match(/第(\d+)段/u)?.[1]);
  await send(e, output);
  if (persist) {
    await saveOrderedProgress(consql, userId(e), title, start, end, length);
    await setSegmentLength(consql, userId(e), length);
    await saveLastArticleConfig(consql, userId(e), { mode: 'ordered', length, title, condition: conditionText });
  }
  openArticleSession(sessionKey(e), {
    title, mode: 'ordered', length, startPosition: start, nextPosition: end,
    segment: number, condition: compileScoreCondition(conditionText), conditionText,
    body, articleRevision: articleRevision(body), lastMessage: output
  });
  return output;
}

async function sendNextOrderedSegment(e, title, length, conditionText = '') {
  return withOrderedLock(orderedLockKey(userId(e), title), async () => {
    const body = await readArticle(title), chars = [...body];
    const state = await getProgressState(consql, userId(e), title);
    if (state.position >= chars.length) throw new Error('这篇文章已经发完了。');
    const segment = orderedSegment(chars, state.position, length);
    return deliverOrderedSegment(e, { title, body, start: state.position, end: segment.nextPosition, length, conditionText });
  });
}

async function list(e, command) {
  let names = command.category ? listCategoryArticles(command.category) : listArticles();
  if (command.keyword) names = names.filter(name => name.includes(command.keyword));
  if (!names.length) return send(e, '暂无文章。');
  const page = Math.max(1, command.page || 1), size = 50;
  const pageNames = names.slice((page - 1) * size, page * size);
  const display = command.showLength
    ? await Promise.all(pageNames.map(async title => `${title}（${[...(await readArticleViews(title)).compactText].length}字）`))
    : pageNames;
  return send(e, `文章列表（${page}/${Math.max(1, Math.ceil(names.length / size))}，共 ${names.length} 篇）\n${display.join('\n')}`);
}

async function progress(e, args) {
  const settings = await getArticleSettings(consql, userId(e));
  if (!settings.current_title) return send(e, '尚未选择文章，请先发送“-选 <标题>”。');
  const title = settings.current_title, body = await readArticle(title), length = [...body].length;
  const oldPosition = await getProgress(consql, userId(e), title);
  const expression = args.join(' ').trim();
  let position = oldPosition;
  if (expression) {
    const match = expression.match(/^([+=-])(\d+)$/);
    if (!match) throw new Error('格式：-进、-进 +500、-进 -500 或 -进 =12345。');
    const value = Number(match[2]);
    position = match[1] === '+' ? oldPosition + value : match[1] === '-' ? oldPosition - value : value;
    position = clampProgress(position, length);
    await setProgress(consql, userId(e), title, position);
    // A manual seek supersedes the old in-memory session. Otherwise -发 or
    // -下 could reuse its stale message/nextPosition and appear to rewind.
    closeArticleSession(sessionKey(e));
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
  let title = parsed.title || settings.current_title;
  if (!title) throw new Error('尚未选择文章，请先发送“-选 <标题>”或在命令后附文章标题。');
  if (mode === 'ordered') {
    if (parsed.title) title = await selectArticle(consql, userId(e), title);
    return sendNextOrderedSegment(e, title, parsed.length, condition);
  }
  const view = await readArticleViews(title), body = view.compactText, chars = [...body];
  await setSegmentLength(consql, userId(e), parsed.length);
  let segment;
  if (mode === 'paragraph') segment = randomParagraph(chars, parsed.length);
  else if (mode === 'characters') {
    const start = randomArgs.range ? randomArgs.range.start - 1 : 0;
    const end = randomArgs.range ? randomArgs.range.end : view.lines.length;
    segment = randomLines(view.lines, parsed.length, Math.random, start, end);
  }
  const displayTitle = mode === 'characters'
    ? `${title}（乱序${randomArgs.range ? `第${randomArgs.range.start}-${randomArgs.range.end}行` : '全文'}）`
    : title;
  const output = formatArticleMessage(segment.text, { title: displayTitle, trigger: triggerName(e) });
  const number = Number(output.match(/第(\d+)段/u)?.[1]);
  await saveLastArticleConfig(consql, userId(e), { mode, length: parsed.length, title, condition, ...(randomArgs.range ? { rangeStart: randomArgs.range.start, rangeEnd: randomArgs.range.end } : {}) });
  openArticleSession(sessionKey(e), { title, mode, length: parsed.length, rangeStart: randomArgs.range?.start ?? null, rangeEnd: randomArgs.range?.end ?? null, startPosition: null, nextPosition: null, segment: number, condition: compileScoreCondition(condition), conditionText: condition, body: body, articleRevision: articleRevision(mode === 'characters' ? view.text : body), lastMessage: output });
  return send(e, output);
}

async function findDifficultySegment(titles, length, difficulty, mapRecords, excluded) {
  const range = DIFFICULTY_RANGES[normalizeDifficulty(difficulty)];
  const titleSet = new Set(titles), bodyCache = new Map();
  const distance = score => score >= range[0] && score < range[1] ? 0 : score < range[0] ? range[0] - score : score - range[1];
  const evaluate = async (title, start) => {
    if (!titleSet.has(title) || excluded.has(`${title}:${start}`)) return null;
    const body = bodyCache.has(title) ? bodyCache.get(title) : await readArticle(title).then(text => (bodyCache.set(title, text), text));
    const chars = [...body], actualStart = Math.max(0, Math.min(chars.length - length, start));
    if (actualStart < 0 || actualStart + length > chars.length || excluded.has(`${title}:${actualStart}`)) return null;
    const text = chars.slice(actualStart, actualStart + length).join(''), [score, , rank, error] = get_rank(text);
    return error ? null : { title, text, body, start: actualStart, score, rank };
  };
  const sources = [
    ...candidateCacheGet(length, difficulty),
    ...mapRecords.filter(record => titleSet.has(record.title) && Number.isInteger(record.start)).sort((a, b) => distance(a.score) - distance(b.score)).slice(0, 1000)
  ].filter((source, index, all) => all.findIndex(item => item.title === source.title && item.start === source.start) === index)
    .sort(() => Math.random() - 0.5);
  let best = null;
  for (const source of sources) {
    const candidate = await evaluate(source.title, source.start);
    if (!candidate) continue;
    if (!best || distance(candidate.score) < distance(best.score)) best = candidate;
    if (isDifficultyMatch(candidate.score, difficulty)) return candidate;
  }
  const deadline = Date.now() + 5000;
  for (let attempt = 0; attempt < 300 && Date.now() <= deadline; attempt++) {
    const title = titles[Math.floor(Math.random() * titles.length)];
    const body = bodyCache.has(title) ? bodyCache.get(title) : await readArticle(title).then(text => (bodyCache.set(title, text), text));
    const chars = [...body];
    if (chars.length < length) continue;
    const start = Math.floor(Math.random() * (chars.length - length + 1));
    const candidate = await evaluate(title, start);
    if (!candidate) continue;
    if (!best || distance(candidate.score) < distance(best.score)) best = candidate;
    if (isDifficultyMatch(candidate.score, difficulty)) return candidate;
  }
  return best;
}

async function difficultyMode(e, difficulty, args, persistedCondition = '') {
  const settings = await getArticleSettings(consql, userId(e));
  const parsed = parseSegmentArguments(args, Number(settings.segment_length) || 100);
  const titles = listArticles(), map = await readDifficultyMap();
  const previous = getArticleSession(sessionKey(e));
  const normalized = normalizeDifficulty(difficulty);
  const sameMode = previous?.mode === 'difficulty' && previous.length === parsed.length && previous.difficulty === normalized;
  const recent = sameMode ? (previous.recentSegments || []) : [];
  let excluded = new Set(recent.map(item => `${item.title}:${item.start}`));
  let result = await findDifficultySegment(titles, parsed.length, normalized, map.records || [], excluded);
  if (!result && excluded.size) { excluded = new Set(); result = await findDifficultySegment(titles, parsed.length, normalized, map.records || [], excluded); }
  if (!result) throw new Error('没有找到可用段落。');
  const revision = articleRevision(result.body);
  candidateCachePut({ length: parsed.length, difficulty, title: result.title, revision, start: result.start, score: result.score });
  await setSegmentLength(consql, userId(e), parsed.length);
  const output = formatArticleMessage(result.text, { title: result.title, trigger: triggerName(e) });
  const number = Number(output.match(/第(\d+)段/u)?.[1]);
  const recentSegments = [...recent, { title: result.title, start: result.start }].slice(-20);
  const condition = String(persistedCondition || '').trim();
  await saveLastArticleConfig(consql, userId(e), { mode: 'difficulty', length: parsed.length, difficulty: normalized, condition });
  openArticleSession(sessionKey(e), { title: result.title, mode: 'difficulty', difficulty: normalized, length: parsed.length, startPosition: null, nextPosition: null, segment: number, condition: compileScoreCondition(condition), conditionText: condition, body: result.text, articleRevision: revision, recentSegments, lastMessage: output });
  return send(e, output);
}

async function repeatOrdered(e, title, length, conditionText = '', session = null) {
  return withOrderedLock(orderedLockKey(userId(e), title), async () => {
    const body = await readArticle(title), articleLength = [...body].length;
    const state = await getProgressState(consql, userId(e), title);
    const repeat = resolveOrderedRepeat(state, articleLength);
    if (session?.lastMessage && session.articleRevision === articleRevision(body) && isOrderedSessionCurrent(session, state, articleLength)) {
      touchArticleSession(session);
      return send(e, session.lastMessage);
    }
    if (session) closeArticleSession(sessionKey(e));
    if (repeat.range) return deliverOrderedSegment(e, { title, body, ...repeat.range, conditionText, persist: false });
    if (repeat.completed) throw new Error('这篇文章已经发完了。');
    const segment = orderedSegment([...body], state.position, length);
    return deliverOrderedSegment(e, { title, body, start: state.position, end: segment.nextPosition, length, conditionText });
  });
}

async function resumeLastConfig(e, repeatOrderedSegment = false) {
  const settings = await getArticleSettings(consql, userId(e));
  let mode = settings.last_mode, title = settings.last_title || settings.current_title;
  if (!mode && title) mode = 'ordered';
  if (!mode) throw new Error('尚未找到上一次发文配置，请先发送一次发文命令。');
  const length = String(settings.segment_length || 100);
  if (mode === 'difficulty') return difficultyMode(e, settings.last_difficulty, [length], settings.last_condition || '');
  if (!title) throw new Error('上一次发文没有可用的文章标题。');
  if (mode === 'ordered' && repeatOrderedSegment) return repeatOrdered(e, title, Number(length), settings.last_condition || '');
  const args = [length, title];
  if (mode === 'characters' && settings.last_range_start != null && settings.last_range_end != null) args.push(`${settings.last_range_start}-${settings.last_range_end}`);
  if (settings.last_condition) args.push('|', settings.last_condition);
  return articleMode(e, mode, args);
}

async function repeatLast(e) {
  const session = getArticleSession(sessionKey(e));
  if (session?.lastMessage) {
    if (session.mode === 'ordered') return repeatOrdered(e, session.title, session.length, session.conditionText, session);
    const view = await readArticleViews(session.title);
    const source = session.mode === 'characters' ? view.text : view.compactText;
    if (session.articleRevision === articleRevision(source)) {
      touchArticleSession(session);
      return send(e, session.lastMessage);
    }
    return continueSession(e, session);
  }
  return resumeLastConfig(e, true);
}

async function conditionStatus(e) {
  const session = getArticleSession(sessionKey(e));
  if (session) return send(e, session.conditionText ? `当前会话自动续段条件：${session.conditionText}` : '当前会话未设置自动续段条件（无条件续段）。');
  const settings = await getArticleSettings(consql, userId(e));
  return send(e, settings.last_condition ? `已保存的自动续段条件：${settings.last_condition}` : '当前没有已设置的自动续段条件。');
}

async function continueSession(e, session) {
  touchArticleSession(session);
  if (session.mode === 'difficulty') return difficultyMode(e, session.difficulty, [String(session.length)], session.conditionText);
  const args = [String(session.length), session.title];
  if (session.mode === 'characters' && session.rangeStart != null && session.rangeEnd != null) args.push(`${session.rangeStart}-${session.rangeEnd}`);
  if (session.conditionText) args.push('|', session.conditionText);
  return articleMode(e, session.mode, args);
}

async function sendPreviousOrderedSegment(e, session) {
  const settings = await getArticleSettings(consql, userId(e));
  let mode = session?.mode || settings.last_mode;
  const title = session?.title || settings.last_title || settings.current_title;
  if (!mode && title) mode = 'ordered';
  if (mode !== 'ordered' || !title) throw new Error('只有顺序发文支持回到上一段。');
  const conditionText = session?.conditionText ?? settings.last_condition ?? '';
  return withOrderedLock(orderedLockKey(userId(e), title), async () => {
    const body = await readArticle(title), articleLength = [...body].length;
    const state = await getProgressState(consql, userId(e), title);
    const range = previousOrderedRange(state, articleLength);
    if (!range) throw new Error('没有可靠的上一段记录，请先发送一次“-顺”或“-下”。');
    if (range.atBeginning) throw new Error('已经是第一段，无法上一段。');
    return deliverOrderedSegment(e, { title, body, ...range, conditionText });
  });
}

async function handleSessionCommand(e, command) {
  const key = sessionKey(e), session = getArticleSession(key);
  if (command.action === '停' || command.action === '结束发文') { closeArticleSession(key); return send(e, '当前发文会话已结束。'); }
  if (command.action === '自' || command.action === '设置自动续段') {
    if (!session) throw new Error('当前没有发文会话。');
    const conditionText = (command.args || []).join(' ').trim();
    session.condition = compileScoreCondition(conditionText); session.conditionText = conditionText; touchArticleSession(session);
    await saveLastArticleCondition(consql, userId(e), conditionText);
    return send(e, conditionText ? `自动续段条件已设置：${conditionText}` : '已恢复无条件自动续段。');
  }
  if (command.action === '下' || command.action === '下一段') {
    if (!session) return resumeLastConfig(e, false);
    return continueSession(e, session);
  }
  if (command.action === '上' || command.action === '上一段') {
    return sendPreviousOrderedSegment(e, session);
  }
}

async function handleScore(e) {
  const score = parseScore(e.raw_message);
  if (!score) return;
  const session = getArticleSession(sessionKey(e));
  if (!session || score.segment !== session.segment || !session.condition(score.metrics)) return;
  if (session.mode === 'ordered') {
    const body = await readArticle(session.title), articleLength = [...body].length;
    const state = await getProgressState(consql, userId(e), session.title);
    if (state.position >= articleLength) {
      closeArticleSession(sessionKey(e));
      return send(e, '这篇文章已经发完了。');
    }
    if (!isOrderedSessionCurrent(session, state, articleLength)) {
      closeArticleSession(sessionKey(e));
      return;
    }
  }
  await continueSession(e, session);
}

bot.on('message', async e => {
  try {
    const command = parseArticleCommand(extractDirectArticleText(e.message));
    if (!command) return;
    if (command.action === '发') return await repeatLast(e);
    if (command.action === '条件') return await conditionStatus(e);
    if (command.action === 'list') return await list(e, command);
    if (command.action === '选' || command.action === '选择文章') {
      if (!command.args?.length) throw new Error('格式：-选 <文章标题>');
      return await send(e, `已选择文章“${await selectArticle(consql, userId(e), command.args.join(' '))}”。`);
    }
    if (command.action === '进' || command.action === '文章进度') return await progress(e, command.args || []);
    if (command.action === '搜' || command.action === '文内搜索') {
      if (!command.args?.length) throw new Error('格式：-搜 <关键词> [页码] [于 <文章标题>]');
      return await search(e, command.args);
    }
    if (command.action === '顺' || command.action === '顺序发文') return await articleMode(e, 'ordered', command.args);
    if (command.action === '随' || command.action === '随机段落发文') return await articleMode(e, 'paragraph', command.args);
    if (command.action === '乱' || command.action === '随机选字发文') return await articleMode(e, 'characters', command.args);
    if (command.action === '难度发文') {
      if (!command.args?.length) throw new Error('格式：-难度发文 <淼|水|易|普|难|虐|爆表> [字数]');
      const difficulty = command.args[0];
      return await difficultyMode(e, difficulty, command.args.slice(1));
    }
    const difficultyAliases = { '淼': '淼', '水': '水', '易': '易', '普': '普', '难': '难', '虐': '虐', '爆': '爆表' };
    if (difficultyAliases[command.action]) return await difficultyMode(e, difficultyAliases[command.action], command.args);
    if (['上', '上一段', '下', '下一段', '停', '结束发文', '自', '设置自动续段'].includes(command.action)) return await handleSessionCommand(e, command);
    return;
  } catch (err) {
    try { await send(e, `发文操作失败：${err.message}`); }
    catch (replyError) { console.error('发送发文错误回复失败：', replyError?.message || replyError); }
  }
});

bot.on('message', async e => {
  if (String(e.raw_message || '').startsWith(ARTICLE_PREFIX)) return;
  try { await handleScore(e); } catch (err) { console.warn('处理发文成绩失败：', err.message); }
});
