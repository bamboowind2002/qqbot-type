import readline from 'node:readline';
import { listArticles } from '../dist/articleStorage.js';
import { readArticle, searchArticle, clampProgress } from '../dist/articleUser.js';
import { parseSegmentArguments, parseRandomRange, orderedSegment, randomParagraph, randomCharacters } from '../dist/articleModes.js';
import { formatArticleMessage } from '../dist/articleMessage.js';
import { chooseDifficultySegment } from '../dist/articleDifficulty.js';
import { get_rank } from '../dist/rank.js';
import { startDifficultyMapTask, getDifficultyMapTaskStatus } from '../dist/articleMapManager.js';

export function parseCliLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  const [command, ...args] = text.split(/\s+/);
  return { command, args };
}

function printHelp() {
  console.log(`命令：
  文 [关键词]             列出文章
  选 <标题>               选择文章
  进 [+/−/=数字]          查看或修改顺序进度
  顺 [字数]               顺序发文
  随 [字数]               随机段落发文
  乱 [字数] [起止]        随机不重复下标发文，如：乱 20 1-100
  难 <难度> [字数]        难度发文
  搜 <关键词>             搜索当前文章
  索                      同步难度地图
  状                      查看地图任务状态
  帮助 / 退出`);
}

export async function runCli({ input = process.stdin, output = process.stdout } = {}) {
  const state = { title: null, length: 100, progress: new Map() };
  const write = value => output.write(`${value}\n`);
  const names = () => listArticles();
  const getSelected = () => { if (!state.title) throw new Error('请先使用“选 <标题>”。'); return state.title; };
  const send = (body, title = state.title) => write(formatArticleMessage(body, { title, trigger: 'CLI' }));

  printHelp();
  const rl = readline.createInterface({ input, output, terminal: false });
  for await (const line of rl) {
    try {
      const parsed = parseCliLine(line);
      if (!parsed) continue;
      const { command, args } = parsed;
      if (command === '退出' || command === 'exit' || command === 'quit') break;
      if (command === '帮助' || command === 'help') { printHelp(); continue; }
      if (command === '文' || command === 'list') {
        const keyword = args.join(' '), result = names().filter(name => !keyword || name.includes(keyword));
        write(result.length ? result.join('\n') : '没有匹配文章。'); continue;
      }
      if (command === '选' || command === 'select') {
        const title = args.join(' ');
        if (!names().includes(title)) throw new Error(`未找到文章“${title}”。`);
        state.title = title; if (!state.progress.has(title)) state.progress.set(title, 0); write(`已选择：${title}`); continue;
      }
      if (command === '进' || command === 'progress') {
        const title = getSelected(), length = [...await readArticle(title)].length, old = state.progress.get(title) || 0;
        let position = old;
        if (args[0]) {
          const match = args[0].match(/^([+=-])(\d+)$/); if (!match) throw new Error('格式：进、进 +500、进 -500 或 进 =123。');
          const value = Number(match[2]); position = match[1] === '+' ? old + value : match[1] === '-' ? old - value : value;
          position = clampProgress(position, length); state.progress.set(title, position);
        }
        write(`${title}：${position}/${length} 字（${length ? (position * 100 / length).toFixed(2) : '100.00'}%）`); continue;
      }
      if (['顺', '随', '乱', 'ordered', 'paragraph', 'random'].includes(command)) {
        const title = args.find(arg => names().includes(arg)) || getSelected(), body = await readArticle(title), chars = [...body];
        const titleArgs = args.filter(arg => arg !== title), rangeResult = command === '乱' ? parseRandomRange(titleArgs) : { args: titleArgs, range: null };
        const parsedLength = parseSegmentArguments(rangeResult.args, state.length); state.length = parsedLength.length;
        let segment;
        if (command === '顺' || command === 'ordered') { const position = state.progress.get(title) || 0; if (position >= chars.length) throw new Error('这篇文章已经发完了。'); segment = orderedSegment(chars, position, parsedLength.length); state.progress.set(title, segment.nextPosition); }
        else if (command === '随' || command === 'paragraph') segment = randomParagraph(chars, parsedLength.length);
        else segment = rangeResult.range ? randomCharacters(chars, parsedLength.length, Math.random, rangeResult.range.start - 1, rangeResult.range.end) : randomCharacters(chars, parsedLength.length);
        send(segment.text, title); continue;
      }
      if (command === '难' || command === 'difficulty') {
        if (!args[0]) throw new Error('格式：难 <淼|水|易|普|难|虐|爆表> [字数]');
        const difficulty = args[0], parsedLength = parseSegmentArguments(args.slice(1), state.length); state.length = parsedLength.length;
        const articles = []; for (const title of names()) articles.push({ title, text: await readArticle(title) });
        const result = chooseDifficultySegment(articles, parsedLength.length, difficulty, get_rank); if (!result) throw new Error('没有找到可用段落。');
        send(result.text, result.title); continue;
      }
      if (command === '搜' || command === 'search') {
        const result = searchArticle(await readArticle(getSelected()), args.join(' '));
        write(result.items.length ? result.items.map(item => `第 ${item.position} 字：${item.context}`).join('\n') : '没有找到。'); continue;
      }
      if (command === '索' || command === 'map') { write('难度地图同步中，请稍候...'); const result = await startDifficultyMapTask(); write(result.cancelled ? '同步已取消。' : `同步完成：${result.records.length} 条记录。`); continue; }
      if (command === '状' || command === 'status') { write(JSON.stringify(getDifficultyMapTaskStatus())); continue; }
      throw new Error(`未知命令“${command}”，输入“帮助”查看用法。`);
    } catch (error) { write(`错误：${error.message}`); }
  }
  rl.close();
}

if (import.meta.url === `file://${process.argv[1]}`) runCli().catch(error => { console.error(error); process.exitCode = 1; });
