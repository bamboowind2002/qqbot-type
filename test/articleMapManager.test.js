import test from 'node:test';
import assert from 'node:assert/strict';
import { getDifficultyMapTaskStatus, cancelDifficultyMapTask } from '../dist/articleMapManager.js';

test('map manager is idle without starting a worker', () => {
  assert.equal(getDifficultyMapTaskStatus().running, false);
  assert.equal(cancelDifficultyMapTask(), false);
});
