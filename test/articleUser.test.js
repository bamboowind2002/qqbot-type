import test from 'node:test';
import assert from 'node:assert/strict';
import { clampProgress, searchArticle } from '../dist/articleUser.js';

test('clamps article progress to the valid Unicode range', () => {
  assert.equal(clampProgress(-3, 10), 0);
  assert.equal(clampProgress(20, 10), 10);
  assert.throws(() => clampProgress(1.5, 10), /整数/);
});

test('searches by Unicode characters and paginates with context', () => {
  const result = searchArticle('甲😀乙甲😀乙', '😀乙', 2, 1);
  assert.deepEqual(result.positions, [2, 5]);
  assert.equal(result.page, 2);
  assert.equal(result.items[0].position, 5);
  assert.match(result.items[0].context, /甲😀乙/);
});
