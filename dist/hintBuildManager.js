import { fork } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const workerPath = resolve(dirname(fileURLToPath(import.meta.url)), 'hintBuildWorker.cjs');
const BUILD_TIMEOUT_MS = 30 * 60 * 1000;

class KeyedMutex {
  constructor() {
    this.tails = new Map();
  }

  async withKeys(keys, operation) {
    const uniqueKeys = [...new Set(keys)].sort();
    const releases = [];
    try {
      for (const key of uniqueKeys) {
        const previous = this.tails.get(key) || Promise.resolve();
        let release;
        const current = new Promise(resolvePromise => { release = resolvePromise; });
        this.tails.set(key, current);
        await previous;
        releases.push({ key, current, release });
      }
      return await operation();
    } finally {
      for (let i = releases.length - 1; i >= 0; --i) {
        const { key, current, release } = releases[i];
        release();
        if (this.tails.get(key) === current) this.tails.delete(key);
      }
    }
  }
}

const mutationMutex = new KeyedMutex();
let buildTail = Promise.resolve();

function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('operation aborted');
}

function runBuildProcess(base, timeoutMs, signal) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const child = fork(workerPath, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let reply = null;
    let settled = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    let forceKillTimer = null;

    const abort = () => {
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    };
    signal?.addEventListener('abort', abort, { once: true });

    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolvePromise(true);
    };

    child.once('error', finish);
    child.on('message', message => { reply = message; });
    child.once('exit', (code, exitSignal) => {
      if (signal?.aborted) finish(abortError(signal));
      else if (reply && reply.ok && code === 0) finish();
      else finish(new Error(reply?.error || `hint builder exited (${code ?? exitSignal})`));
    });
    child.send({ type: 'build', base });
  });
}

// The native builder itself is synchronous, but only this child process is
// blocked. Chaining jobs keeps temporary disk and memory peaks from stacking.
export function buildHintAsync(base, options = {}) {
  // Keep the former numeric timeout argument working for local utilities.
  const timeoutMs = typeof options === 'number'
    ? options
    : options.timeoutMs ?? BUILD_TIMEOUT_MS;
  const onStart = typeof options === 'object' ? options.onStart : null;
  const signal = typeof options === 'object' ? options.signal : null;
  const job = buildTail.then(async () => {
    if (signal?.aborted) throw abortError(signal);
    if (onStart) await onStart();
    if (signal?.aborted) throw abortError(signal);
    return runBuildProcess(base, timeoutMs, signal);
  });
  buildTail = job.catch(() => undefined);
  return job;
}

export const withUserMutations = (qqids, operation) =>
  mutationMutex.withKeys(qqids.map(qqid => `user:${qqid}`), operation);

export const withUserMutation = (qqid, operation) =>
  withUserMutations([qqid], operation);

export const withSchemeMutations = (names, operation) =>
  mutationMutex.withKeys(names.map(name => `scheme:${name}`), operation);

let nextUploadId = 1;
const latestUserUploads = new Map();

function getUserUploads(qqid, create = false) {
  const key = String(qqid);
  let uploads = latestUserUploads.get(key);
  if (!uploads && create) {
    uploads = new Map();
    latestUserUploads.set(key, uploads);
  }
  return uploads || null;
}

export function beginLatestUserUpload(qqid, name) {
  const key = String(qqid);
  const uploads = getUserUploads(key, true);
  const previous = [...uploads.values()]
    .filter(task => task.name === name)
    .sort((left, right) => right.id - left.id)[0] || null;
  let previousState = 'none';
  if (previous) {
    if (previous.cancelable) {
      previousState = 'cancelled';
      const error = new Error(`superseded by upload ${name}`);
      error.code = 'UPLOAD_SUPERSEDED';
      error.replacementName = name;
      previous.controller.abort(error);
    } else {
      previousState = 'committing';
    }
  }
  const task = {
    id: nextUploadId++,
    qqid: key,
    name,
    controller: new AbortController(),
    cancelable: true,
    phase: '已接收上传请求',
    previousName: previous?.name || null,
    previousState
  };
  uploads.set(task.id, task);
  return task;
}

export function finishLatestUserUpload(task) {
  const uploads = getUserUploads(task.qqid);
  uploads?.delete(task.id);
  if (uploads?.size === 0) latestUserUploads.delete(task.qqid);
}

export function cancelLatestUserUpload(qqid, name = null) {
  const uploads = getUserUploads(qqid);
  const task = [...(uploads?.values() || [])]
    .filter(item => name === null || item.name === name)
    .sort((left, right) => right.id - left.id)[0];
  if (!task) return { state: 'none' };
  if (task.controller.signal.aborted) {
    return { state: 'cancelling', name: task.name, phase: task.phase };
  }
  if (!task.cancelable) {
    return { state: 'committing', name: task.name, phase: task.phase };
  }
  const error = new Error('cancelled by user');
  error.code = 'UPLOAD_CANCELLED';
  task.controller.abort(error);
  return { state: 'cancelled', name: task.name, phase: task.phase };
}

export function cancelUploadsForSchemes(names, details = {}) {
  const schemeNames = new Set(names);
  const matching = [];
  for (const uploads of latestUserUploads.values()) {
    for (const task of uploads.values()) {
      if (!schemeNames.has(task.name) || task.controller.signal.aborted) continue;
      matching.push(task);
    }
  }
  const committing = matching.filter(task => !task.cancelable).length;
  if (committing > 0) return { cancelled: 0, committing };

  for (const task of matching) {
    const error = new Error(`scheme ${task.name} is being renamed`);
    error.code = 'UPLOAD_SCHEME_RENAMED';
    error.oldName = details.oldName || null;
    error.newName = details.newName || null;
    task.controller.abort(error);
  }
  return { cancelled: matching.length, committing: 0 };
}

export function throwIfUploadSuperseded(task) {
  if (task.controller.signal.aborted) throw abortError(task.controller.signal);
}
