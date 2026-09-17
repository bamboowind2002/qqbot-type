import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodePointIndex, sliceCodePoints } from '../dist/unicodeText.js';

test('sparse Unicode indexes slice without splitting surrogate pairs', () => {
  const text = '甲😀乙𨇭丙丁';
  const index = createCodePointIndex(text, 2);
  assert.equal(index.length, 6);
  assert.deepEqual(index.offsets, [0, 3, 6, 8]);
  assert.equal(sliceCodePoints(text, 1, 3, index), '😀乙𨇭');
  assert.equal(sliceCodePoints(text, 4, 20, index), '丙丁');
  const characters = [...text];
  for (let start = 0; start <= characters.length; start++) {
    for (let length = 0; length <= characters.length + 1; length++) {
      assert.equal(sliceCodePoints(text, start, length, index), characters.slice(start, start + length).join(''));
    }
  }
});
