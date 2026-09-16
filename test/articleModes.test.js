import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSegmentArguments, orderedSegment, randomParagraph, randomCharacters } from '../dist/articleModes.js';

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
