// worker-process.mjs


// 这里使用 process.on
process.on("message", async ({ fnCode, args }) => {
  try {
    // 将同步函数反序列化
    const fn = eval(fnCode);

    // 执行函数（可以是死循环、CPU任务、native addon，完全没问题）
    const result = fn(...args);

    process.send({ ok: true, result });
  } catch (err) {
    process.send({ ok: false, error: err.stack || err.toString() });
  } finally {
    process.exit();
  }
});
