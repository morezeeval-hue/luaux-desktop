/* Main-thread client for the Luau Web Worker. Runs execution off the UI
 * thread so a hot loop in learner code can't freeze the app; a timeout
 * terminates and restarts the worker instead of hanging forever. */
window.LuauRuntime = (function () {
  "use strict";
  let worker = null;
  let ready = false;
  let readyWaiters = [];
  let pending = null;
  let token = 0;

  function spawn() {
    ready = false;
    worker = new Worker("luau_worker.js");
    worker.onmessage = (e) => {
      const data = e.data;
      if (data.type === "ready") {
        ready = true;
        readyWaiters.forEach((r) => r());
        readyWaiters = [];
      } else if (data.type === "error") {
        readyWaiters.forEach((_, i) => readyWaiters[i]());
        readyWaiters = [];
      } else if (data.type === "run_result" && pending && data.token === pending.token) {
        clearTimeout(pending.timeoutID);
        pending.resolve({ exitCode: data.exitCode, stdout: data.stdout || [], stderr: data.stderr || [], error: data.error || null });
        pending = null;
      }
    };
    worker.postMessage({ type: "init" });
  }

  spawn();

  function ensureReady() {
    if (ready) return Promise.resolve();
    return new Promise((resolve) => readyWaiters.push(resolve));
  }

  async function run(code) {
    await ensureReady();
    if (pending) throw new Error("Runtime is still executing the previous run.");
    token += 1;
    const myToken = token;
    return new Promise((resolve) => {
      const timeoutID = setTimeout(() => {
        if (pending && pending.token === myToken) {
          pending = null;
          worker.terminate();
          spawn();
          resolve({ exitCode: -99, stdout: [], stderr: ["Execution timed out (possible infinite loop). Runtime restarted."], error: "timeout" });
        }
      }, 15000);
      pending = { token: myToken, resolve, timeoutID };
      worker.postMessage({ type: "run", code, token: myToken });
    });
  }

  return { ensureReady, run, get isReady() { return ready; } };
})();
