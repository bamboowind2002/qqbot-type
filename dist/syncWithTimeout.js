import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Native regular-expression traversal is synchronous; durable subprocesses
// keep it away from the bot event loop while retaining their mmap pools.
class RegularWorkerPool {
  constructor() { this.workers = []; this.queue = []; this.schemas = []; this.nextId = 1; }
  configure(schemas) {
    this.schemas = [...new Set(schemas)];
    if (!this.workers.length) this.spawn();
    return this.broadcast('preload', { schemas: this.schemas });
  }
  spawn() {
    const child = fork(__dirname + '/worker.cjs');
    const worker = { child, ready: false, busy: null, updates: new Map() };
    this.workers.push(worker);
    child.on('message', msg => this.message(worker, msg));
    child.on('exit', (code, signal) => this.exit(worker, `worker exited (${code ?? signal})`));
    child.on('error', err => this.exit(worker, err.message));
    child.send({ type: 'preload', schemas: this.schemas });
    return worker;
  }
  message(worker, msg) {
    if (msg.type === 'ready') { worker.ready = true; this.dispatch(); return; }
    if (msg.type === 'updated') { const resolve = worker.updates.get(msg.id); if (resolve) { worker.updates.delete(msg.id); resolve(msg.ok); } this.dispatch(); return; }
    if (msg.type !== 'result' || !worker.busy) return;
    const job = worker.busy; worker.busy = null; clearTimeout(job.timer);
    msg.ok ? job.resolve(msg.result) : job.reject(new Error(msg.error)); this.dispatch();
  }
  exit(worker, reason) {
    const index = this.workers.indexOf(worker); if (index < 0) return;
    this.workers.splice(index, 1);
    if (worker.busy) { clearTimeout(worker.busy.timer); worker.busy.reject(new Error(reason)); }
    for (const resolve of worker.updates.values()) resolve(false);
    // Avoid a tight respawn loop when the addon itself cannot initialize.
    if (this.workers.length < 1 || this.queue.length) setTimeout(() => this.spawn(), 250).unref();
  }
  dispatch() {
    while (this.queue.length) {
      const worker = this.workers.find(w => w.ready && !w.busy);
      if (!worker) { if (this.workers.length < 2) this.spawn(); return; }
      const job = this.queue.shift(); worker.busy = job;
      job.timer = setTimeout(() => { if (worker.busy === job) worker.child.kill('SIGKILL'); }, job.timeout);
      worker.child.send({ type: 'task', id: job.id, operation: job.operation, args: job.args });
    }
  }
  run(operation, args, timeout = 15000) {
    return new Promise((resolve, reject) => { this.queue.push({ id: this.nextId++, operation, args, timeout, resolve, reject, timer: null }); if (!this.workers.length) this.spawn(); this.dispatch(); });
  }
  broadcast(type, payload) {
    const id = this.nextId++;
    return Promise.all(this.workers.map(worker => new Promise(resolve => { worker.updates.set(id, resolve); worker.child.send({ type, id, ...payload }); })));
  }
  replace(schema) { return this.broadcast('replace', { schema }); }
  remove(schema) { return this.broadcast('remove', { schema }); }
}
const pool = new RegularWorkerPool();
export const configureRegularWorkers = schemas => pool.configure(schemas);
export const replaceRegularWorkerScheme = schema => pool.replace(schema);
export const removeRegularWorkerScheme = schema => pool.remove(schema);
export const runRegularWithTimeout = (operation, args, timeout = 15000) => pool.run(operation, args, timeout);
