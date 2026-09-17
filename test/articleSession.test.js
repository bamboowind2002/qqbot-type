import test from 'node:test';
import assert from 'node:assert/strict';
import { articleRevision, parseScore, compileScoreCondition, parseMetricNumber } from '../dist/articleSession.js';

test('parses score metrics, percentages, and time as seconds', () => {
  const score = parseScore('第45550段 速度166.73 击键6.59 键准82.15% 字数100 时间00:35.987');
  assert.equal(score.segment, 45550);
  assert.equal(score.metrics.速度, 166.73);
  assert.equal(score.metrics.键准, 82.15);
  assert.equal(score.metrics.时间, 35.987);
  assert.equal(parseMetricNumber('01:02:03'), 3723);
});

test('evaluates arbitrary metrics with precedence and parentheses', () => {
  const condition = compileScoreCondition('速度>=150 且 击键>=6 或 (键准>=95% 且 时间<00:40)');
  assert.equal(condition({ 速度: 151, 击键: 6.1, 键准: 80, 时间: 60 }), true);
  assert.equal(condition({ 速度: 100, 击键: 1, 键准: 95, 时间: 39 }), true);
  assert.equal(condition({ 速度: 100 }), false);
});

test('empty condition is unconditional and malformed conditions fail early', () => {
  assert.equal(compileScoreCondition('')({}), true);
  assert.throws(() => compileScoreCondition('速度>'), /格式/);
  assert.throws(() => compileScoreCondition('速度>=1 foo'), /无法识别|格式/);
});

test('article revisions detect content and line-break changes', () => {
  assert.equal(articleRevision('甲\n乙'), articleRevision('甲\n乙'));
  assert.notEqual(articleRevision('甲\n乙'), articleRevision('甲乙'));
  assert.notEqual(articleRevision('甲乙'), articleRevision('甲丙'));
});
