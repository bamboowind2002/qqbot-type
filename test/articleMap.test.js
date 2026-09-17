import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTICLE_MAP_BLOCK_SIZE, canReuseDifficultyGeneration, difficultyBlockRanges, filterDifficultyMapRecords, getDifficultyMapStatus } from '../dist/articleMap.js';

test('difficulty map covers every exact 100-character block without caps', () => {
  assert.equal(ARTICLE_MAP_BLOCK_SIZE, 100);
  assert.deepEqual(difficultyBlockRanges(1), [{ start: 0, length: 1 }]);
  assert.deepEqual(difficultyBlockRanges(100), [{ start: 0, length: 100 }]);
  assert.deepEqual(difficultyBlockRanges(101), [{ start: 0, length: 100 }, { start: 100, length: 1 }]);
  const long = difficultyBlockRanges(500_001);
  assert.equal(long.length, 5001);
  assert.deepEqual(long.at(-1), { start: 500_000, length: 1 });
  assert.equal(getDifficultyMapStatus().running, false);
});

test('only matching algorithm and block size can reuse an active generation', () => {
  const active = { algorithm_version: 'rank-v1', block_size: 100 };
  assert.equal(canReuseDifficultyGeneration(active), true);
  assert.equal(canReuseDifficultyGeneration(active, 'rank-v2'), false);
  assert.equal(canReuseDifficultyGeneration(active, 'rank-v1', 200), false);
});

test('difficulty maps discard records with null or invalid ranks', () => {
  const valid = { title: '甲', start: 0, length: 100, score: 0.2, rank: '水' };
  assert.deepEqual(filterDifficultyMapRecords([
    valid,
    { title: '乙', start: 0, length: 100, score: -1, rank: null },
    { title: '丙', start: 0, length: 100, score: 1, rank: '未知' }
  ]), [valid]);
});
