import test from 'node:test';
import assert from 'node:assert/strict';
import { isOrderedSessionCurrent, orderedLockKey, previousOrderedRange, resolveOrderedRepeat, storedOrderedRange, withOrderedLock } from '../dist/articleOrdered.js';

test('uses the persisted tail range when moving to the previous segment', () => {
  const tail = { position: 250, lastStart: 200, lastEnd: 250, lastLength: 100 };
  assert.deepEqual(storedOrderedRange(tail, 250), { start: 200, end: 250, length: 100 });
  assert.deepEqual(previousOrderedRange(tail, 250), { start: 100, end: 200, length: 100 });
  assert.deepEqual(previousOrderedRange({ position: 200, lastStart: 100, lastEnd: 200, lastLength: 100 }, 250), { start: 0, end: 100, length: 100 });
  assert.deepEqual(previousOrderedRange({ position: 100, lastStart: 0, lastEnd: 100, lastLength: 100 }, 250), { atBeginning: true });
});

test('rejects missing, manually shifted, and stale ordered ranges', () => {
  assert.equal(storedOrderedRange({ position: 150, lastStart: null, lastEnd: null, lastLength: null }, 250), null);
  assert.equal(storedOrderedRange({ position: 150, lastStart: 0, lastEnd: 100, lastLength: 100 }, 250), null);
  const state = { position: 200, lastStart: 100, lastEnd: 200, lastLength: 100 };
  assert.equal(isOrderedSessionCurrent({ mode: 'ordered', startPosition: 100, nextPosition: 200 }, state, 250), true);
  assert.equal(isOrderedSessionCurrent({ mode: 'ordered', startPosition: 0, nextPosition: 100 }, state, 250), false);
});

test('repeats a persisted final segment before treating the article as completed', () => {
  const tail = { position: 250, lastStart: 200, lastEnd: 250, lastLength: 100 };
  assert.deepEqual(resolveOrderedRepeat(tail, 250), { range: { start: 200, end: 250, length: 100 }, completed: false });
  assert.deepEqual(resolveOrderedRepeat({ position: 250, lastStart: null, lastEnd: null, lastLength: null }, 250), { range: null, completed: true });
});

test('serializes ordered operations for the same user and article', async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const key = orderedLockKey('1', '文章');
  const first = withOrderedLock(key, async () => { events.push('first-start'); await firstGate; events.push('first-end'); });
  const second = withOrderedLock(key, async () => { events.push('second'); });
  await Promise.resolve();
  assert.deepEqual(events, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second']);
});
