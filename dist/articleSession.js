const sessions = new Map();
const TTL = 60 * 60 * 1000;

export function sessionKey(e) {
  return e.message_type === 'group' ? `group:${e.group_id}:${e.sender?.user_id}` : `private:${e.sender?.user_id ?? e.user_id}`;
}

function cleanup(key) {
  const value = sessions.get(key);
  if (value && value.expires <= Date.now()) { sessions.delete(key); return null; }
  return value || null;
}

export function getArticleSession(key) { return cleanup(key); }
export function closeArticleSession(key) { sessions.delete(key); }

export function openArticleSession(key, value) {
  const session = { ...value, key, expires: Date.now() + TTL };
  sessions.set(key, session);
  return session;
}

export function touchArticleSession(session) { session.expires = Date.now() + TTL; return session; }

export function parseScore(text) {
  text = String(text ?? '');
  const segment = text.match(/第(\d+)段/u)?.[1];
  if (!segment) return null;
  const metrics = {};
  const field = /([\p{Script=Han}\p{L}_]+)\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?|-?\d+(?:\.\d+)?%?)/gu;
  for (const match of text.matchAll(field)) {
    const name = match[1];
    if (name.startsWith('第')) continue;
    const raw = match[2];
    metrics[name] = raw.endsWith('%') ? Number(raw.slice(0, -1)) : parseMetricNumber(raw);
  }
  return { segment: Number(segment), metrics };
}

export function parseMetricNumber(value) {
  value = String(value);
  if (!value.includes(':')) return Number(value);
  const parts = value.split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function tokenize(expression) {
  const tokens = [];
  const re = /\s*(>=|<=|!=|>|<|=|\(|\)|且|或|\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?%?|[\p{L}\p{N}_%]+)\s*/gu;
  let position = 0, match;
  while ((match = re.exec(expression))) {
    if (match.index !== position) throw new Error('成绩条件中有无法识别的内容。');
    tokens.push(match[1]); position = re.lastIndex;
  }
  if (position !== String(expression).length) throw new Error('成绩条件中有无法识别的内容。');
  return tokens;
}

export function compileScoreCondition(expression) {
  expression = String(expression ?? '').trim();
  if (!expression) return () => true;
  const tokens = tokenize(expression);
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  function primary() {
    if (take() === '(') { const result = or(); if (take() !== ')') throw new Error('成绩条件括号不匹配。'); return result; }
    index--; const name = take(), operator = take(), expectedToken = take();
    if (!name || !operator || !expectedToken || !['>', '>=', '<', '<=', '=', '!='].includes(operator)) throw new Error('成绩条件格式应为“指标>=数值”。');
    const expected = expectedToken.endsWith('%') ? Number(expectedToken.slice(0, -1)) : parseMetricNumber(expectedToken);
    if (!Number.isFinite(expected)) throw new Error('成绩条件中的数值无效。');
    return metrics => {
      const actual = metrics[name]; if (!Number.isFinite(actual)) return false;
      return operator === '>' ? actual > expected : operator === '>=' ? actual >= expected : operator === '<' ? actual < expected : operator === '<=' ? actual <= expected : operator === '=' ? actual === expected : actual !== expected;
    };
  }
  function and() { let result = primary(); while (peek() === '且') { take(); const right = primary(); const left = result; result = metrics => left(metrics) && right(metrics); } return result; }
  function or() { let result = and(); while (peek() === '或') { take(); const right = and(); const left = result; result = metrics => left(metrics) || right(metrics); } return result; }
  const result = or(); if (index !== tokens.length) throw new Error('成绩条件格式错误。'); return result;
}
