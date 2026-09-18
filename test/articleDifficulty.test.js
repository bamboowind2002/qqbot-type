import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseDifficultySegment,
  isDifficultyMatch,
  isValidDifficultyResult,
  normalizeDifficulty
} from '../dist/articleDifficulty.js';
import { analyze_rank, get_rank } from '../dist/rank.js';

test('difficulty boundaries exclude negative scores from 淼', () => {
  assert.equal(isDifficultyMatch(-1, '淼'), false);
  assert.equal(isDifficultyMatch(0, '淼'), true);
  assert.equal(isDifficultyMatch(0.0999, '淼'), true);
  assert.equal(isDifficultyMatch(0.1, '淼'), false);
  assert.equal(isValidDifficultyResult(-1, '淼', false), false);
  assert.equal(isValidDifficultyResult(0, '淼', false), true);
});

test('validates the supported difficulty names and aliases', () => {
  assert.equal(normalizeDifficulty('爆'), '爆');
  assert.equal(normalizeDifficulty('爆表'), '爆表');
  assert.throws(() => normalizeDifficulty('未知'), /难度只能/);
});

test('reject-samples until it finds an exact target difficulty', () => {
  const articles = [{ title: '甲', text: 'a'.repeat(20) }, { title: '乙', text: 'b'.repeat(20) }];
  const ranks = text => text[0] === 'a'
    ? [20, 'nue', '虐', false]
    : [0.2, 'shui', '水', false];
  let randomCalls = 0;
  const result = chooseDifficultySegment(articles, 10, '水', ranks, () => {
    randomCalls++;
    return randomCalls === 3 ? 0.99 : 0;
  }, () => 0);
  assert.equal(result.title, '乙');
  assert.equal(result.score, 0.2);
  assert.equal(result.attempts, 2);
});

test('does not return the nearest difficulty when sampling fails', () => {
  const result = chooseDifficultySegment(
    [{ title: '甲', text: 'a'.repeat(20) }],
    10,
    '水',
    () => [20, 'nue', '虐', false],
    () => 0,
    () => 0
  );
  assert.equal(result, null);
});

test('stops after the rejection sampling attempt budget', () => {
  let evaluations = 0;
  const result = chooseDifficultySegment(
    [{ title: '甲', text: 'a'.repeat(10) }],
    10,
    '水',
    () => { evaluations++; return [20, 'nue', '虐', false]; },
    () => 0,
    () => 0
  );
  assert.equal(result, null);
  assert.equal(evaluations, 1000);
});

test('excludes recently used segments', () => {
  const result = chooseDifficultySegment(
    [{ title: '甲', text: 'a'.repeat(30) }],
    10,
    '水',
    () => [0.2, 'shui', '水', false],
    (() => {
      let calls = 0;
      return () => ++calls === 4 ? 0.1 : 0;
    })(),
    () => 0,
    new Set(['甲:0'])
  );
  assert.notEqual(result.start, 0);
});

test('rejects invalid rank results and insufficient articles', () => {
  assert.equal(chooseDifficultySegment([{ title: '无效', text: 'x'.repeat(10) }], 10, '淼', () => [-1, null, null, null], () => 0, () => 0), null);
  assert.throws(() => chooseDifficultySegment([{ title: '短', text: 'x'.repeat(9) }], 10, '淼', get_rank), /没有长度达到/);
});

test('rank analysis keeps negative empty input outside all difficulty ranks', () => {
  const result = analyze_rank('   ');
  assert.deepEqual(get_rank('   '), [result.score, result.rankEn, result.rank, result.error]);
  assert.equal(result.score, -1);
  assert.equal(isDifficultyMatch(result.score, '淼'), false);
});
