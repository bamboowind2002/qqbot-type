import test from 'node:test';
import assert from 'node:assert/strict';
import { clampProgress, getProgressState, saveLastArticleConfig, saveOrderedProgress, searchArticle, setProgress } from '../dist/articleUser.js';

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

test('validates persisted last article modes', async () => {
  assert.rejects(() => saveLastArticleConfig({ query() {} }, '1', { mode: 'invalid', length: 100 }), /无效/);
});

test('reads persisted ordered segment metadata', async () => {
  const connection = { query(sql, values, callback) { callback(null, [{ position: 200 }]); } };
  assert.deepEqual(await getProgressState(connection, '1', '文章'), { position: 200 });
});

test('writes the current ordered position and clears it on exhaustion', async () => {
  const calls = [];
  const connection = { query(sql, values, callback) { calls.push({ sql, values }); callback(null, {}); } };
  assert.deepEqual(await saveOrderedProgress(connection, '1', '文章', 200), { position: 200 });
  assert.deepEqual(calls[0].values, ['1', '文章', 200]);
  assert.match(calls[0].sql, /insert into article_progress \(qqid, title, position\)/);
  await setProgress(connection, '1', '文章', 123);
  assert.deepEqual(calls[1].values, ['1', '文章', 123]);
  await setProgress(connection, '1', '文章', null);
  assert.deepEqual(calls[2].values, ['1', '文章', null]);
});
