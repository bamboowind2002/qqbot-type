import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDifficultyIndex, weightedDifficultySelection } from '../dist/articleDifficultyCatalog.js';

test('builds descending lengths and prefix sums', () => {
  const index = buildDifficultyIndex([
    { title: '短', char_count: 10 },
    { title: '长', char_count: 20 },
    { title: '中', char_count: 15 }
  ]);
  assert.deepEqual(index.items.map(item => item.title), ['长', '中', '短']);
  assert.deepEqual(index.prefixLengths, [20, 35, 45]);
});

test('samples every article/start pair with contiguous weighted ranges', () => {
  const index = buildDifficultyIndex([
    { title: '甲', char_count: 5 },
    { title: '乙', char_count: 3 }
  ]);
  const samples = [0, 1, 2, 3, 4, 5].map(value => weightedDifficultySelection(index, 3, () => value / 6));
  assert.deepEqual(samples.map(item => `${item.title}:${item.start}`), ['甲:0', '甲:0', '甲:1', '甲:2', '甲:2', '乙:0']);
  assert.equal(samples[0].articleLength, 5);
});

test('returns null when no article can contain the requested length', () => {
  const index = buildDifficultyIndex([{ title: '短', char_count: 2 }]);
  assert.equal(weightedDifficultySelection(index, 3), null);
});

test('uses exclusive random upper bound', () => {
  const index = buildDifficultyIndex([{ title: '文章', char_count: 10 }]);
  assert.throws(() => weightedDifficultySelection(index, 3, () => 1), /\[0, 1\)/);
});
