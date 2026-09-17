import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseDifficultySegment, isValidDifficultyResult, normalizeDifficulty } from '../dist/articleDifficulty.js';

test('selects an exact difficulty candidate before falling back to nearest', () => {
  const articles = [{ title: '甲', text: 'abcdefghij' }, { title: '乙', text: 'klmnopqrst' }];
  const ranks = text => text === 'abcdefghij' ? [0.2, 'shui', '水', false] : [20, 'nue', '虐', false];
  const exact = chooseDifficultySegment(articles, 10, '水', ranks, () => 0);
  assert.equal(exact.rank, '水');
  const fallback = chooseDifficultySegment(articles, 10, '普', ranks, () => 0);
  assert.equal(fallback.rank, '水');
});

test('validates the seven supported difficulty names', () => {
  assert.equal(normalizeDifficulty('爆'), '爆');
  assert.equal(normalizeDifficulty('爆表'), '爆表');
  assert.throws(() => normalizeDifficulty('未知'), /难度只能/);
});

test('prefers nearby map records before random fallback', () => {
  const articles = [{ title: '甲', text: 'abcdefghij' }, { title: '乙', text: 'klmnopqrst' }];
  const hints = [{ title: '乙', start: 0, length: 100, score: 0.2 }, { title: '甲', start: 0, length: 100, score: 20 }];
  const result = chooseDifficultySegment(articles, 10, '水', () => [0.2, 'shui', '水', false], () => 0, () => Date.now(), hints);
  assert.equal(result.title, '乙');
});

test('can exclude recently used difficulty segments', () => {
  const result = chooseDifficultySegment([{ title: '甲', text: '甲'.repeat(300) }], 100, '水', () => [0.2, 0, '水', null], () => 0.5, () => 0, [], new Set(['甲:0']));
  assert.notEqual(result.start, 0);
});

test('rejects difficulty results without a valid rank', () => {
  assert.equal(isValidDifficultyResult(-1, null, null), false);
  assert.equal(isValidDifficultyResult(0.2, '水', null), true);
  const result = chooseDifficultySegment([{ title: '无效', text: 'x'.repeat(10) }], 10, '淼', () => [-1, null, null, null], () => 0, () => 0);
  assert.equal(result, null);
});
