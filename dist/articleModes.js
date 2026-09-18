import { countCodePoints, createCodePointIndex, sliceCodePoints } from './unicodeText.js';

export function parseSegmentArguments(args, defaultLength = 100) {
  const values = [...(args || [])];
  let length = defaultLength;
  if (/^\d+$/.test(values[0] || '')) length = Number(values.shift());
  if (!Number.isInteger(length) || length < 10 || length > 2000) throw new Error('每段字数必须是 10 至 2000 的整数。');
  return { length, title: values.join(' ').trim() };
}

function sourceLength(source, index) { return Array.isArray(source) ? source.length : (index || createCodePointIndex(source)).length; }
function sourceSlice(source, start, length, index) {
  return Array.isArray(source) ? source.slice(start, start + length).join('') : sliceCodePoints(source, start, length, index);
}

export function orderedSegment(source, position, length, index = null) {
  const total = sourceLength(source, index);
  return { text: sourceSlice(source, position, length, index), nextPosition: Math.min(total, position + length) };
}

export function randomParagraph(source, length, random = Math.random, index = null) {
  const total = sourceLength(source, index);
  if (total < length) throw new Error(`文章只有 ${total} 字，不足 ${length} 字。`);
  const start = Math.floor(random() * (total - length + 1));
  return { text: sourceSlice(source, start, length, index), start };
}

export function randomParagraphSelection(compactLength, length, random = Math.random) {
  if (compactLength < length) throw new Error(`文章只有 ${compactLength} 字，不足 ${length} 字。`);
  const start = Math.floor(random() * (compactLength - length + 1));
  return { type: 'compact', start, length };
}

export function parseRandomRange(args) {
  const values = [...(args || [])];
  let index = -1, match = null;
  for (let i = values.length - 1; i >= 0; i--) {
    const candidate = values[i];
    const found = candidate.match(/^(?:范围=)?(\d+)[~-](\d+)$/u) || candidate.match(/^(?:范围=)?(\d+)至(\d+)$/u);
    if (found) { index = i; match = found; break; }
  }
  if (!match) return { args: values, range: null };
  const start = Number(match[1]), end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) throw new Error('乱序下标范围必须是正整数起点和不小于起点的终点。');
  values.splice(index, 1);
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

export function randomLines(lines, length, random = Math.random, rangeStart = 0, rangeEnd = lines.length, lineLengths = null, linePrefix = null) {
  if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 0 || rangeEnd > lines.length || rangeEnd <= rangeStart) throw new Error('乱序下标范围超出文章行数。');
  lineLengths ||= lines.map(countCodePoints);
  const available = linePrefix ? linePrefix[rangeEnd] - linePrefix[rangeStart] : lineLengths.slice(rangeStart, rangeEnd).reduce((total, value) => total + value, 0);
  if (available < length) throw new Error(`指定行范围内容不足 ${length} 字。`);
  const indexes = Array.from({ length: rangeEnd - rangeStart }, (_, index) => index + rangeStart);
  const selected = [];
  let total = 0;
  while (total < length) {
    const offset = selected.length + Math.floor(random() * (indexes.length - selected.length));
    [indexes[selected.length], indexes[offset]] = [indexes[offset], indexes[selected.length]];
    const index = indexes[selected.length];
    selected.push(index);
    total += lineLengths[index];
  }
  const text = selected.map(index => lines[index]).join('');
  return { text: sliceCodePoints(text, 0, length), indexes: selected };
}

export function randomLineSelection(lineLengths, length, random = Math.random, rangeStart = 0, rangeEnd = lineLengths.length) {
  if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 0 || rangeEnd > lineLengths.length || rangeEnd <= rangeStart) throw new Error('乱序下标范围超出文章行数。');
  const available = lineLengths.slice(rangeStart, rangeEnd).reduce((total, value) => total + value, 0);
  if (available < length) throw new Error(`指定行范围内容不足 ${length} 字。`);
  const indexes = Array.from({ length: rangeEnd - rangeStart }, (_, index) => index + rangeStart);
  const selected = [];
  let total = 0;
  while (total < length) {
    const offset = selected.length + Math.floor(random() * (indexes.length - selected.length));
    [indexes[selected.length], indexes[offset]] = [indexes[offset], indexes[selected.length]];
    const index = indexes[selected.length];
    selected.push(index);
    total += lineLengths[index];
  }
  return { type: 'lines', indexes: selected, length };
}
