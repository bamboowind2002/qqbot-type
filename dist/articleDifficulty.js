export const DIFFICULTY_RANGES = Object.freeze({
  '淼': [-Infinity, 0.1], '水': [0.1, 0.3], '易': [0.3, 0.8],
  '普': [0.8, 5], '难': [5, 15], '虐': [15, 100], '爆': [100, Infinity], '爆表': [100, Infinity]
});

export function normalizeDifficulty(value) {
  const name = String(value || '').trim();
  if (!DIFFICULTY_RANGES[name]) throw new Error('难度只能是：淼、水、易、普、难、虐或爆表。');
  return name === '爆表' ? '爆表' : name;
}

function distance(score, [low, high]) {
  if (score >= low && score < high) return 0;
  return score < low ? low - score : score - high;
}

function inRange(score, [low, high]) { return score >= low && score < high; }

export function chooseDifficultySegment(articles, length, difficulty, getRank, random = Math.random, now = () => Date.now()) {
  difficulty = normalizeDifficulty(difficulty);
  if (!Number.isInteger(length) || length < 10 || length > 2000) throw new Error('每段字数必须是 10 至 2000 的整数。');
  const eligible = articles.filter(article => [...article.text].length >= length);
  if (!eligible.length) throw new Error(`没有长度达到 ${length} 字的文章。`);
  const range = DIFFICULTY_RANGES[difficulty], deadline = now() + 5000;
  let best = null, attempts = 0;
  while (attempts < 300 && now() <= deadline) {
    const article = eligible[Math.floor(random() * eligible.length)];
    const chars = [...article.text], start = Math.floor(random() * (chars.length - length + 1));
    const text = chars.slice(start, start + length).join(''), [score, , rank, error] = getRank(text);
    attempts++;
    if (error) continue;
    const candidate = { title: article.title, text, start, score, rank, attempts };
    if (!best || distance(score, range) < distance(best.score, range) ||
      (distance(score, range) === distance(best.score, range) && random() < 0.5)) best = candidate;
    if (inRange(score, range)) return candidate;
  }
  return best;
}
