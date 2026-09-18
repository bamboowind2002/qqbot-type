import { createCodePointIndex, sliceCodePoints } from './unicodeText.js';

export const DIFFICULTY_RANGES = Object.freeze({
  '淼': [0, 0.1], '水': [0.1, 0.3], '易': [0.3, 0.8],
  '普': [0.8, 5], '难': [5, 15], '虐': [15, 100],
  '爆': [100, Infinity], '爆表': [100, Infinity]
});

const VALID_DIFFICULTY_RANKS = new Set(['淼', '水', '易', '普', '难', '虐', '爆表']);
const MAX_ATTEMPTS = 300;
const MAX_DURATION_MS = 5000;

export function isValidDifficultyResult(score, rank, error = false) {
  return !error && Number.isFinite(score) && score >= 0 && VALID_DIFFICULTY_RANKS.has(rank);
}

export function normalizeDifficulty(value) {
  const name = String(value || '').trim();
  if (!DIFFICULTY_RANGES[name]) throw new Error('难度只能是：淼、水、易、普、难、虐或爆表。');
  return name;
}

export function isDifficultyMatch(score, difficulty) {
  if (!Number.isFinite(score) || score < 0) return false;
  const [low, high] = DIFFICULTY_RANGES[normalizeDifficulty(difficulty)];
  return score >= low && score < high;
}

function randomIndex(random, length) {
  return Math.min(length - 1, Math.floor(random() * length));
}

function prepareArticles(articles, length) {
  return articles.map(article => ({
    ...article,
    textIndex: article.textIndex || createCodePointIndex(article.text)
  })).filter(article => article.textIndex.length >= length);
}

// Reject-sample a uniformly random article and a uniformly random contiguous
// segment. A result is returned only when it actually belongs to the target
// difficulty range; there is no nearest-score fallback.
export function chooseDifficultySegment(
  articles,
  length,
  difficulty,
  getRank,
  random = Math.random,
  now = () => Date.now(),
  excluded = new Set()
) {
  difficulty = normalizeDifficulty(difficulty);
  if (!Number.isInteger(length) || length < 10 || length > 2000) throw new Error('每段字数必须是 10 至 2000 的整数。');
  const eligible = prepareArticles(articles, length);
  if (!eligible.length) throw new Error(`没有长度达到 ${length} 字的文章。`);

  const deadline = now() + MAX_DURATION_MS;
  for (let attempts = 1; attempts <= MAX_ATTEMPTS && now() <= deadline; attempts++) {
    const article = eligible[randomIndex(random, eligible.length)];
    const maxStart = article.textIndex.length - length;
    const start = randomIndex(random, maxStart + 1);
    if (excluded.has(`${article.title}:${start}`)) continue;

    const text = sliceCodePoints(article.text, start, length, article.textIndex);
    const [score, , rank, error] = getRank(text);
    if (!isValidDifficultyResult(score, rank, error) || !isDifficultyMatch(score, difficulty)) continue;
    return { title: article.title, text, start, score, rank, attempts };
  }
  return null;
}

// Streaming counterpart used by the bot. A sample touches one article, one
// selected segment, and calls getRank exactly once before deciding its fate.
export async function chooseDifficultySegmentStreaming(
  titles, length, difficulty, scan, read, getRank,
  random = Math.random, now = () => Date.now(), excluded = new Set(), deadline = now() + MAX_DURATION_MS,
  budget = null
) {
  difficulty = normalizeDifficulty(difficulty);
  if (!Number.isInteger(length) || length < 10 || length > 2000) throw new Error('每段字数必须是 10 至 2000 的整数。');
  if (!titles.length) throw new Error(`没有长度达到 ${length} 字的文章。`);
  const initialAttempts = budget?.attempts || 0;
  for (let attempts = 1; attempts <= MAX_ATTEMPTS - initialAttempts && now() <= deadline; attempts++) {
    if (budget) budget.attempts = initialAttempts + attempts;
    const title = titles[randomIndex(random, titles.length)];
    let metadata;
    try { metadata = await scan(title); }
    catch (error) { if (error?.code === 'ENOENT') continue; if (error?.code === 'ARTICLE_CHANGED') continue; throw error; }
    if (metadata.compactLength < length) { await new Promise(resolve => setImmediate(resolve)); continue; }
    const start = randomIndex(random, metadata.compactLength - length + 1);
    if (excluded.has(`${title}:${start}`)) { await new Promise(resolve => setImmediate(resolve)); continue; }
    let selected;
    try { selected = await read(title, { type: 'compact', start, length }, metadata); }
    catch (error) { if (error?.code === 'ARTICLE_CHANGED') { await new Promise(resolve => setImmediate(resolve)); continue; } throw error; }
    const [score, , rank, error] = getRank(selected.text);
    if (isValidDifficultyResult(score, rank, error) && isDifficultyMatch(score, difficulty)) return { title, text: selected.text, start, score, rank, attempts, revision: selected.compactRevision };
    await new Promise(resolve => setImmediate(resolve));
  }
  return null;
}

export const DIFFICULTY_SAMPLE_MAX_ATTEMPTS = MAX_ATTEMPTS;
export const DIFFICULTY_SAMPLE_MAX_DURATION_MS = MAX_DURATION_MS;
