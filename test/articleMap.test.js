import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTICLE_MAP_BLOCK_SIZE, ARTICLE_MAP_MAX_PER_ARTICLE, filterDifficultyMapRecords, getDifficultyMapStatus } from '../dist/articleMap.js';

test('difficulty map uses the planned bounded block constants', () => {
  assert.equal(ARTICLE_MAP_BLOCK_SIZE, 100);
  assert.equal(ARTICLE_MAP_MAX_PER_ARTICLE, 5000);
  assert.equal(getDifficultyMapStatus().running, false);
});

test('difficulty maps discard records with null or invalid ranks', () => {
  const valid = { title: '甲', start: 0, length: 100, score: 0.2, rank: '水' };
  assert.deepEqual(filterDifficultyMapRecords([
    valid,
    { title: '乙', start: 0, length: 100, score: -1, rank: null },
    { title: '丙', start: 0, length: 100, score: 1, rank: '未知' }
  ]), [valid]);
});
