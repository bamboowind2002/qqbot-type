// syncWithTimeout.mjs
import { fork } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function runSyncWithTimeout(fn, args = [], timeout = 5000) {
  return new Promise((resolve, reject) => {
    const child = fork(__dirname + "/worker.cjs", [], {
      execArgv: ["--experimental-modules"] // 如果需要 ESM
    });

    let done = false;

    // 超时杀掉进程
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill("SIGKILL");
        reject(new Error("Timeout"));
      }
    }, timeout);

    // 接收子进程的执行结果
    child.on("message", (msg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);

      if (msg.ok) {
        resolve(msg.result);
      } else {
        reject(new Error(msg.error));
      }
      child.kill();
    });

    // 发送函数与参数
    child.send({
      fnCode: fn.toString(),
      args
    });
  });
}
