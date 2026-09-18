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

export function orderedRangeAt(position, length, articleLength) {
  if (!Number.isSafeInteger(position) || position < 0 || position >= articleLength) return null;
  if (!Number.isSafeInteger(length) || length < 1) return null;
  return { start: position, end: Math.min(articleLength, position + length), length };
}

export function nextOrderedRange(state, length, articleLength) {
  if (state?.position == null) return orderedRangeAt(0, length, articleLength);
  const start = state.position;
  const current = orderedRangeAt(start, length, articleLength);
  if (!current) return null;
  return orderedRangeAt(current.end, length, articleLength);
}

export function previousOrderedRange(state, length, articleLength) {
  const position = state?.position;
  if (!Number.isSafeInteger(position) || position <= 0) return { atBeginning: true };
  const start = Math.max(0, position - length);
  return orderedRangeAt(start, length, articleLength) ? { start, end: position, length } : null;
}

export function resolveOrderedRepeat(state, length, articleLength) {
  if (articleLength <= 0) return { range: null, completed: true };
  if (state?.position == null) return { range: orderedRangeAt(0, length, articleLength), completed: false };
  if (state.position >= articleLength) return { range: null, completed: true };
  return { range: orderedRangeAt(state.position, length, articleLength), completed: false };
}

export function isOrderedSessionCurrent(session, state, articleLength) {
  return Boolean(session?.mode === 'ordered' && Number.isSafeInteger(state?.position) &&
    Number.isSafeInteger(session.startPosition) && session.startPosition === state.position &&
    Number.isSafeInteger(session.nextPosition) && session.nextPosition > session.startPosition &&
    session.nextPosition <= articleLength);
}
