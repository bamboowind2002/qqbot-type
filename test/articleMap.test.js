import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTICLE_MAP_BLOCK_SIZE, ARTICLE_MAP_MAX_PER_ARTICLE, getDifficultyMapStatus } from '../dist/articleMap.js';

test('difficulty map uses the planned bounded block constants', () => {
  assert.equal(ARTICLE_MAP_BLOCK_SIZE, 100);
  assert.equal(ARTICLE_MAP_MAX_PER_ARTICLE, 5000);
  assert.equal(getDifficultyMapStatus().running, false);
});
