import test from 'node:test';
import assert from 'node:assert/strict';
import { getActiveDifficultyGeneration, sampleDifficultyRecords } from '../dist/articleDifficultyStore.js';

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
