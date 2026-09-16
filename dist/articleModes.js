export function parseSegmentArguments(args, defaultLength = 100) {
  const values = [...(args || [])];
  let length = defaultLength;
  if (/^\d+$/.test(values[0] || '')) length = Number(values.shift());
  if (!Number.isInteger(length) || length < 10 || length > 2000) throw new Error('每段字数必须是 10 至 2000 的整数。');
  return { length, title: values.join(' ').trim() };
}

export function orderedSegment(chars, position, length) {
  return { text: chars.slice(position, position + length).join(''), nextPosition: Math.min(chars.length, position + length) };
}

export function randomParagraph(chars, length, random = Math.random) {
  if (chars.length < length) throw new Error(`文章只有 ${chars.length} 字，不足 ${length} 字。`);
  const start = Math.floor(random() * (chars.length - length + 1));
  return { text: chars.slice(start, start + length).join(''), start };
}

export function parseRandomRange(args) {
  const values = [...(args || [])];
  const token = values.at(-1) || '';
  const match = token.match(/^(?:范围=)?(\d+)[~-](\d+)$/u) || token.match(/^(?:范围=)?(\d+)至(\d+)$/u);
  if (!match) return { args: values, range: null };
  const start = Number(match[1]), end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) throw new Error('乱序下标范围必须是正整数起点和不小于起点的终点。');
  values.pop();
  return { args: values, range: { start, end } };
}

export function randomCharacters(chars, length, random = Math.random, rangeStart = 0, rangeEnd = chars.length) {
  if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 0 || rangeEnd > chars.length || rangeEnd <= rangeStart) throw new Error('乱序下标范围超出文章范围。');
  if (rangeEnd - rangeStart < length) throw new Error(`指定下标范围只有 ${rangeEnd - rangeStart} 字，不足 ${length} 个不同下标。`);
  const indexes = Array.from({ length: rangeEnd - rangeStart }, (_, index) => index + rangeStart);
  for (let i = 0; i < length; i++) {
    const j = i + Math.floor(random() * (indexes.length - i));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return { text: indexes.slice(0, length).map(index => chars[index]).join(''), indexes: indexes.slice(0, length) };
}
