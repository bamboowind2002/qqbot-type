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

export function randomCharacters(chars, length, random = Math.random) {
  if (chars.length < length) throw new Error(`文章只有 ${chars.length} 字，不足 ${length} 字。`);
  const indexes = Array.from({ length: chars.length }, (_, index) => index);
  for (let i = 0; i < length; i++) {
    const j = i + Math.floor(random() * (indexes.length - i));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return { text: indexes.slice(0, length).map(index => chars[index]).join(''), indexes: indexes.slice(0, length) };
}
