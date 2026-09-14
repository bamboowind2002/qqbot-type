const word_hint = require('../build/Release/word_hint.node');
function execute(operation, args) {
  if (operation === 'simple') { const [pattern, schema, range] = args, re = new RegExp(pattern, 'u'); const result = word_hint.solve_simple_func(s => re.test(s), schema, range); result.word = pattern; return result; }
  if (operation === 'search') { const [pattern, schema, range] = args, re = new RegExp(pattern, 'u'); const result = word_hint.solve_search_func(s => re.test(s), schema, range); result.code = pattern; return result; }
  if (operation === 'simple_search') { const [word, code, candidate, schema, range] = args, a = new RegExp(word, 'u'), b = new RegExp(code, 'u'), c = new RegExp(candidate, 'u'); const result = word_hint.solve_simple_search_func(s => a.test(s), s => b.test(s), s => c.test(s), schema, range); result.word = word; result.code_pattern = code; result.chong_pattern = candidate; return result; }
  throw new Error(`unknown regular operation: ${operation}`);
}
process.on('message', message => {
  try {
    if (message.type === 'preload') { const result = word_hint.preload(message.schemas || []); process.send(message.id ? { type: 'updated', id: message.id, ok: true, ...result } : { type: 'ready', ...result }); return; }
    if (message.type === 'replace') { process.send({ type: 'updated', id: message.id, ok: word_hint.replace(message.schema) }); return; }
    if (message.type === 'remove') { word_hint.remove(message.schema); process.send({ type: 'updated', id: message.id, ok: true }); return; }
    if (message.type === 'task') process.send({ type: 'result', id: message.id, ok: true, result: execute(message.operation, message.args) });
  } catch (err) { process.send({ type: 'result', id: message.id, ok: false, error: err.stack || String(err) }); }
});
