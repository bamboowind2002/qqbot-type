import { get_rank } from './rank.js';

export function formatArticleMessage(body, { title = '', segment = '', trigger = '' } = {}) {
  const text = [...String(body ?? '')].filter(char => !/\p{White_Space}/u.test(char)).join('');
  const [score, , rank] = get_rank(text);
  if (!text) throw new Error('正文不能为空。');
  const first = title ? `${title}-${rank}${score.toFixed(2)}` : `${rank}${score.toFixed(2)}`;
  const number = segment || String(Math.floor(Math.random() * (99998 - 10001 + 1)) + 10001);
  return `${first}\n${text}\n-----第${number}段-共${[...text].length}字-${trigger || '未知用户'}`;
}
