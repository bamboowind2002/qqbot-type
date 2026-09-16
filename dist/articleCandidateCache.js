const GROUP_LIMIT = 200;
const GLOBAL_LIMIT = 50_000;
const groups = new Map();
const entries = new Map();

function groupKey(length, difficulty) { return `${length}:${difficulty}`; }
function touch(key, entry) { entries.delete(key); entries.set(key, entry); }

export function candidateCacheGet(length, difficulty) {
  const key = groupKey(length, difficulty), group = groups.get(key) || [];
  group.forEach(entry => touch(`${key}:${entry.title}:${entry.revision}:${entry.start}`, entry));
  return [...group];
}

export function candidateCachePut({ length, difficulty, title, revision, start, score }) {
  const key = groupKey(length, difficulty), group = groups.get(key) || [];
  const entry = { length, difficulty, title, revision, start, score };
  const index = group.findIndex(item => item.title === title && item.revision === revision && item.start === start);
  if (index >= 0) group.splice(index, 1);
  group.unshift(entry); groups.set(key, group.slice(0, GROUP_LIMIT));
  touch(`${key}:${title}:${revision}:${start}`, entry);
  while (entries.size > GLOBAL_LIMIT) {
    const oldest = entries.keys().next().value;
    entries.delete(oldest);
  }
  return entry;
}

export function candidateCacheClear() { groups.clear(); entries.clear(); }
export function candidateCacheStatus() { return { groups: groups.size, entries: entries.size, groupLimit: GROUP_LIMIT, globalLimit: GLOBAL_LIMIT }; }
