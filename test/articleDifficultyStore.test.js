import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTICLE_DIFFICULTY_ALGORITHM_VERSION,
  ARTICLE_DIFFICULTY_COMPOSED_SAMPLE_LIMIT,
  getActiveDifficultyGeneration,
  sampleDifficultyRecords,
  sampleDifficultySegments,
  scoreDifficultySummary
} from '../dist/articleDifficultyStore.js';

function fakeConnection(responses, queries = []) {
  return {
    query(sql, values, callback) {
      queries.push({ sql, values });
      const response = responses.shift();
      if (response instanceof Error) callback(response);
      else callback(null, response);
    }
  };
}

test('missing generation schema selects the JSON fallback', async () => {
  const error = Object.assign(new Error('missing'), { code: 'ER_NO_SUCH_TABLE' });
  assert.equal(await getActiveDifficultyGeneration(fakeConnection([error])), null);
});

test('mixed sampling wraps both random-key indexes without ORDER BY RAND', async () => {
  const recordA = { title: '甲', start: 0, length: 100, score: 0.2, rank: '水', revision: 'a' };
  const recordB = { title: '乙', start: 100, length: 100, score: 0.25, rank: '水', revision: 'b' };
  const queries = [];
  const connection = fakeConnection([
    [{ id: 7, status: 'complete' }],
    [], [recordA],
    [], [recordB]
  ], queries);
  const result = await sampleDifficultyRecords(connection, '水', 2, () => Buffer.alloc(8, 0xff));
  assert.equal(result.backend, 'mysql');
  assert.equal(result.generationId, 7);
  assert.deepEqual(result.records, [recordA, recordB]);
  assert.equal(queries.some(item => /order\s+by\s+rand/iu.test(item.sql)), false);
  assert.equal(queries.length, 5);
  assert.equal(queries.filter(item => /min\(block_key\)/u.test(item.sql)).length, 2);
  assert.equal(queries.filter(item => /article_key\s*</u.test(item.sql)).length, 1);
  assert.equal(queries.filter(item => /block_key\s*</u.test(item.sql)).length, 1);
  assert.equal(queries.filter(item => /order by r\.block_key/u.test(item.sql) && /article_difficulty_articles/u.test(item.sql)).length, 0);
});

test('scores additive difficulty summaries with one shared water baseline', () => {
  assert.equal(scoreDifficultySummary(0.4, 1), 0.2);
  assert.equal(scoreDifficultySummary('bad', 1), null);
});

test('long segments are shortlisted from composed block summaries', async () => {
  const queries = [];
  const articleRecords = Array.from({ length: ARTICLE_DIFFICULTY_COMPOSED_SAMPLE_LIMIT / 2 }, (_, index) => ({
    title: `文章${index}`, start: 0, length: 100, score: 0.2, rank: '水', revision: `a${index}`
  }));
  const blockRecords = Array.from({ length: ARTICLE_DIFFICULTY_COMPOSED_SAMPLE_LIMIT / 2 }, (_, index) => ({
    title: `长文${index}`, start: index * 100, length: 100, score: 0.2, rank: '水'
  }));
  const connection = fakeConnection([
    [{ id: 9, algorithm_version: ARTICLE_DIFFICULTY_ALGORITHM_VERSION, block_size: 100, status: 'complete' }],
    [{ id: 9, algorithm_version: ARTICLE_DIFFICULTY_ALGORITHM_VERSION, block_size: 100, status: 'complete' }],
    articleRecords,
    blockRecords,
    [
      { title: '偏易', start: 0, revision: 'b', hard_score: 0.9, water_delta: 0 },
      { title: '正好水', start: 100, revision: 'a', hard_score: 0.4, water_delta: 1 }
    ]
  ], queries);
  const result = await sampleDifficultySegments(connection, '水', 2000, 10, () => Buffer.alloc(8, 0x80));
  assert.equal(result.backend, 'mysql-summary');
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].title, '正好水');
  assert.equal(result.records[0].score, 0.2);
  assert.equal(queries.length, 5);
  assert.match(queries[4].sql, /\(s\.title, s\.start\) in/u);
  assert.match(queries[4].sql, /e\.valid_prefix - s\.valid_prefix \+ 1 = \?/u);
  assert.equal(queries[4].values[0], 1900);
  assert.equal(queries[4].values.at(-1), 20);
});
