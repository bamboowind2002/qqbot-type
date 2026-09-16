import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateCacheClear, candidateCacheGet, candidateCachePut, candidateCacheStatus } from '../dist/articleCandidateCache.js';

test('candidate cache is grouped and deduplicates recent entries', () => {
  candidateCacheClear();
  candidateCachePut({ length: 100, difficulty: '水', title: '甲', revision: 'r1', start: 0, score: 0.2 });
  candidateCachePut({ length: 100, difficulty: '水', title: '甲', revision: 'r1', start: 0, score: 0.2 });
  assert.equal(candidateCacheGet(100, '水').length, 1);
  assert.equal(candidateCacheStatus().entries, 1);
});
