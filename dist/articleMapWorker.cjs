let map;
let connection;
let cancelPending = false;

function connectMysql(mysql, config) {
  connection = mysql.createConnection(config);
  return new Promise((resolve, reject) => connection.connect(error => error ? reject(error) : resolve()));
}

function closeMysql() {
  if (!connection) return Promise.resolve();
  const current = connection;
  connection = null;
  return new Promise(resolve => current.end(() => resolve()));
}

process.on('message', async message => {
  try {
    if (message?.type === 'cancel') {
      cancelPending = true;
      map?.cancelDifficultyMapSync();
      return;
    }
    if (message?.type !== 'sync') return;
    map = await import('./articleMap.js');
    const mysql = require('mysql');
    const { databaseConfig } = await import('./config.js');
    await connectMysql(mysql, databaseConfig);
    const result = await map.syncDifficultyMap(connection, progress => {
      if (cancelPending) map.cancelDifficultyMapSync();
      process.send?.({ type: 'progress', progress });
    });
    await closeMysql();
    process.send?.({ type: 'result', result }, () => process.disconnect?.());
  } catch (error) {
    await closeMysql();
    process.send?.({ type: 'error', error: error.stack || String(error) }, () => process.disconnect?.());
  } finally {
    // Disconnect only after the IPC callback above flushes the result.
  }
});
