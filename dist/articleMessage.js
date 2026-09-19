import { getArticleRank } from './articleDifficulty.js';

export function formatArticleTitle(title) {
  return String(title ?? '').replace(/^皇叔-/u, '皇叔 ');
}

export function formatArticleMessage(body, { title = '', segment = '', trigger = '' } = {}) {
  const text = [...String(body ?? '')].filter(char => !/\p{White_Space}/u.test(char)).join('');
  const [score, , rank] = getArticleRank(text, title);
  if (!text) throw new Error('正文不能为空。');
  const displayTitle = formatArticleTitle(title);
  const first = displayTitle ? `${displayTitle}-${rank}${score.toFixed(2)}` : `${rank}${score.toFixed(2)}`;
  const number = segment || String(Math.floor(Math.random() * (99998 - 10001 + 1)) + 10001);
  return `${first}\n${text}\n-----第${number}段-共${[...text].length}字-${trigger || '未知用户'}`;
}
