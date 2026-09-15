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

function runBuildProcess(base, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = fork(workerPath, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let reply = null;
    let settled = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(true);
    };

    child.once('error', finish);
    child.on('message', message => { reply = message; });
    child.once('exit', (code, signal) => {
      if (reply && reply.ok && code === 0) finish();
      else finish(new Error(reply?.error || `hint builder exited (${code ?? signal})`));
    });
    child.send({ type: 'build', base });
  });
}

// The native builder itself is synchronous, but only this child process is
// blocked. Chaining jobs keeps temporary disk and memory peaks from stacking.
export function buildHintAsync(base, timeoutMs = BUILD_TIMEOUT_MS) {
  const job = buildTail.then(() => runBuildProcess(base, timeoutMs));
  buildTail = job.catch(() => undefined);
  return job;
}

export const withUserMutation = (qqid, operation) =>
  mutationMutex.withKeys([`user:${qqid}`], operation);

export const withSchemeMutations = (names, operation) =>
  mutationMutex.withKeys(names.map(name => `scheme:${name}`), operation);
