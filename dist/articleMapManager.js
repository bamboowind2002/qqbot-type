import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'articleMapWorker.cjs');
let active = null;
let status = { running: false };

export function getDifficultyMapTaskStatus() { return { ...status }; }

export function cancelDifficultyMapTask() {
  if (!active) return false;
  status.cancelRequested = true;
  active.send({ type: 'cancel' });
  return true;
}

export function startDifficultyMapTask() {
  if (active) throw new Error('难度地图正在同步中。');
  const child = fork(workerPath, { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  active = child;
  status = { running: true, processed: 0, total: 0, changed: 0, records: 0, cancelRequested: false };
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      if (active !== child) return;
      active = null; status = { running: false };
      callback(value);
    };
    child.on('message', message => {
      if (message.type === 'progress') status = { ...status, ...message.progress };
      else if (message.type === 'result') finish(resolve, message.result);
      else if (message.type === 'error') finish(reject, new Error(message.error));
    });
    child.on('error', error => finish(reject, error));
    child.on('exit', code => {
      if (active === child && code !== 0) finish(reject, new Error(`难度地图 worker 已退出（${code}）。`));
    });
    child.send({ type: 'sync' });
  });
}
