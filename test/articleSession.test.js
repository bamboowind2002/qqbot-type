import test from 'node:test';
import assert from 'node:assert/strict';
import { articleRevision, parseScore, compileScoreCondition, parseMetricNumber, withArticleAdvance, openArticleSession, closeArticleSession } from '../dist/articleSession.js';

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

test('concurrent scores and manual next advance the original session only once', async () => {
  for (const mode of ['ordered', 'paragraph', 'characters', 'difficulty']) {
    for (const triggers of [['score', 'score'], ['score', 'next'], ['next', 'score'], ['next', 'next']]) {
      const key = `advance:${mode}:${triggers.join(':')}`;
      openArticleSession(key, { mode, segment: 10001 });
      let unblock;
      const gate = new Promise(resolve => { unblock = resolve; });
      let deliveries = 0;
      const advance = trigger => withArticleAdvance(key, async session => {
        if (trigger === 'score' && session.segment !== 10001) return;
        await gate;
        deliveries++;
        openArticleSession(key, { mode, segment: 10002 });
      });
      const first = advance(triggers[0]);
      const second = advance(triggers[1]);
      unblock();
      await Promise.all([first, second]);
      assert.equal(deliveries, 1);
      await advance('score');
      assert.equal(deliveries, 1, 'old score remains ignored after completion');
      await advance('next');
      assert.equal(deliveries, 2, 'a later manual next still works');
      closeArticleSession(key);
    }
  }
});

test('failed advancement releases the lock for retry and isolates sessions', async () => {
  const key = 'advance:retry';
  openArticleSession(key, { segment: 10001 });
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  const failure = withArticleAdvance(key, async () => { await gate; throw new Error('failed'); });
  const rejected = assert.rejects(failure, /failed/);
  let retried = false;
  const retry = withArticleAdvance(key, async () => { retried = true; });
  await withArticleAdvance('advance:other', async () => {});
  assert.equal(retried, false);
  unblock();
  await Promise.all([rejected, retry]);
  assert.equal(retried, true);
  closeArticleSession(key);
});

test('concurrent manual next without a session restores configuration once', async () => {
  const key = 'advance:resume';
  let restores = 0;
  const resume = () => withArticleAdvance(key, async () => {
    restores++;
    openArticleSession(key, { segment: 10001 });
  });
  await Promise.all([resume(), resume()]);
  assert.equal(restores, 1);
  closeArticleSession(key);
});
