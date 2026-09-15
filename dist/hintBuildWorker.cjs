const wordHint = require('../build/Release/word_hint.node');

process.once('message', message => {
  let result;
  try {
    if (!message || message.type !== 'build' || typeof message.base !== 'string') {
      throw new Error('invalid hint build request');
    }
    result = { ok: Boolean(wordHint.save_table(message.base)) };
    if (!result.ok) result.error = 'save_table returned false';
  } catch (err) {
    result = { ok: false, error: err && (err.stack || err.message) || String(err) };
  }

  if (process.connected) {
    process.send(result, () => process.exit(result.ok ? 0 : 1));
  } else {
    process.exit(result.ok ? 0 : 1);
  }
});

// A dead parent must not leave a multi-gigabyte build running and publishing
// into an abandoned staging directory.
process.once('disconnect', () => process.exit(1));
