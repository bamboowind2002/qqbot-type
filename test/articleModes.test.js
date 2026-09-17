import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSegmentArguments, parseRandomRange, orderedSegment, randomParagraph, randomCharacters, randomLines } from '../dist/articleModes.js';
import { createCodePointIndex } from '../dist/unicodeText.js';

test('parses remembered length and titles containing spaces', () => {
  assert.deepEqual(parseSegmentArguments(['200', '我的', '文章']), { length: 200, title: '我的 文章' });
  assert.deepEqual(parseSegmentArguments([], 123), { length: 123, title: '' });
  assert.throws(() => parseSegmentArguments(['9']), /10 至 2000/);
});

test('supports ordered tail, random paragraphs, and unique random indexes', () => {
  const chars = [...'abcdefgh'];
  assert.deepEqual(orderedSegment(chars, 6, 5), { text: 'gh', nextPosition: 8 });
  assert.equal(randomParagraph(chars, 3, () => 0).text, 'abc');
  const result = randomCharacters(chars, 5, () => 0);
  assert.equal(result.text.length, 5);
  assert.equal(new Set(result.indexes).size, 5);
});

test('ordered and random contiguous segments accept indexed Unicode strings', () => {
  const text = '甲😀乙𨇭丙丁', index = createCodePointIndex(text, 2);
  assert.deepEqual(orderedSegment(text, 4, 10, index), { text: '丙丁', nextPosition: 6 });
  assert.deepEqual(randomParagraph(text, 3, () => 0.25, index), { text: '😀乙𨇭', start: 1 });
});

test('random characters can use an inclusive 1-based range while repeating character values', () => {
  assert.deepEqual(parseRandomRange(['200', '文章', '1000-5000']), { args: ['200', '文章'], range: { start: 1000, end: 5000 } });
  assert.deepEqual(parseRandomRange(['200', '文章', '1000-5000', '|', '速度>=100']), { args: ['200', '文章', '|', '速度>=100'], range: { start: 1000, end: 5000 } });
  const result = randomCharacters([... 'aabc'], 3, () => 0, 0, 4);
  assert.equal(new Set(result.indexes).size, 3);
  assert.equal(result.text, 'aab');
  assert.throws(() => randomCharacters([... 'abcd'], 3, () => 0, 0, 2), /不足/);
});

test('random lines selects distinct line indexes and truncates the final line', () => {
  const result = randomLines(['甲乙', '丙丁戊', '己庚'], 4, () => 0);
  assert.equal(result.text.length, 4);
  assert.equal(new Set(result.indexes).size, result.indexes.length);
  assert.deepEqual(result.indexes, [0, 1]);
  assert.equal(randomLines(['甲乙', '丙丁戊', '己庚'], 4, () => 0, 1, 3).text, '丙丁戊己');
  assert.equal(randomLines(['甲😀', '乙𨇭丙'], 3, () => 0, 0, 2, [2, 3], [0, 2, 5]).text, '甲😀乙');
  assert.throws(() => randomLines(['甲', '乙'], 3), /不足/);
});
