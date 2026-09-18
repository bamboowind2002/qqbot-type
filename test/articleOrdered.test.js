import test from 'node:test';
import assert from 'node:assert/strict';
import { isOrderedSessionCurrent, nextOrderedRange, orderedLockKey, orderedRangeAt, previousOrderedRange, resolveOrderedRepeat, withOrderedLock } from '../dist/articleOrdered.js';

test('uses the current position and segment length for navigation', () => {
  assert.deepEqual(orderedRangeAt(100, 100, 250), { start: 100, end: 200, length: 100 });
  assert.deepEqual(nextOrderedRange({ position: 100 }, 100, 250), { start: 200, end: 250, length: 100 });
  assert.deepEqual(nextOrderedRange({ position: null }, 100, 250), { start: 0, end: 100, length: 100 });
  assert.deepEqual(previousOrderedRange({ position: 200 }, 100, 250), { start: 100, end: 200, length: 100 });
  assert.deepEqual(previousOrderedRange({ position: 0 }, 100, 250), { atBeginning: true });
});

test('matches sessions against the current position', () => {
  assert.equal(isOrderedSessionCurrent({ mode: 'ordered', startPosition: 100, nextPosition: 200 }, { position: 100 }, 250), true);
  assert.equal(isOrderedSessionCurrent({ mode: 'ordered', startPosition: 0, nextPosition: 100 }, { position: 200 }, 250), false);
});

test('repeats the current segment and recognizes completion', () => {
  assert.deepEqual(resolveOrderedRepeat({ position: 200 }, 100, 250), { range: { start: 200, end: 250, length: 100 }, completed: false });
  assert.deepEqual(resolveOrderedRepeat({ position: null }, 100, 250), { range: { start: 0, end: 100, length: 100 }, completed: false });
  assert.deepEqual(resolveOrderedRepeat({ position: 250 }, 100, 250), { range: null, completed: true });
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
