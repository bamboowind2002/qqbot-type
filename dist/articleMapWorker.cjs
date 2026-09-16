let map;

process.on('message', async message => {
  try {
    if (message?.type === 'cancel') {
      map?.cancelDifficultyMapSync();
      return;
    }
    if (message?.type !== 'sync') return;
    map = await import('./articleMap.js');
    const result = await map.syncDifficultyMap(progress => process.send?.({ type: 'progress', progress }));
    process.send?.({ type: 'result', result });
  } catch (error) {
    process.send?.({ type: 'error', error: error.stack || String(error) });
  } finally {
    process.disconnect?.();
  }
});
