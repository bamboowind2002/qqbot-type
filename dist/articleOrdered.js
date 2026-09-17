const locks = new Map();

export async function withOrderedLock(key, task) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  locks.set(key, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

export function orderedLockKey(qqid, title) { return `${qqid}\0${title}`; }

export function storedOrderedRange(state, articleLength) {
  const start = state?.lastStart, end = state?.lastEnd, length = state?.lastLength;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(length)) return null;
  if (start < 0 || end <= start || end > articleLength || length < 1 || state.position !== end) return null;
  return { start, end, length };
}

export function previousOrderedRange(state, articleLength) {
  const current = storedOrderedRange(state, articleLength);
  if (!current) return null;
  if (current.start === 0) return { atBeginning: true };
  return { start: Math.max(0, current.start - current.length), end: current.start, length: current.length };
}

export function isOrderedSessionCurrent(session, state, articleLength) {
  const range = storedOrderedRange(state, articleLength);
  return Boolean(range && session?.mode === 'ordered' && session.startPosition === range.start && session.nextPosition === range.end);
}
