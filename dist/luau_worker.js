/* Web Worker for Luau WASM execution — ported directly from the LuauX
 * server's public/wasm/luau_worker.js so behavior matches exactly. */
importScripts("wasm/luau.js");

let moduleInstance = null;
let isReady = false;
let stdoutBuffer = [];
let stderrBuffer = [];

async function initVM() {
  if (isReady) return;
  try {
    moduleInstance = await LuauWasm({
      locateFile(path) { return "wasm/" + path; },
      print(text) {
        let str = String(text);
        if (str.startsWith("[STDOUT] ")) str = str.substring(9);
        if (!str.startsWith("[METRIC_GC] ")) stdoutBuffer.push(str);
      },
      printErr(text) {
        let str = String(text);
        if (str.startsWith("[ERR] ")) stderrBuffer.push(str.substring(6));
        else if (str.startsWith("[WARN] ")) stdoutBuffer.push("[WARNING] " + str.substring(7));
        else stderrBuffer.push(str);
      },
    });
    isReady = true;
    postMessage({ type: "ready" });
  } catch (err) {
    postMessage({ type: "error", error: err.message || String(err) });
  }
}

const mockHeader = `
local Vector3 = {}
function Vector3.new(x, y, z)
    x, y, z = x or 0, y or 0, z or 0
    return { X = x, Y = y, Z = z, Magnitude = math.sqrt(x*x + y*y + z*z), Unit = {} }
end
local Instance = {}
function Instance.new(className)
    return { ClassName = className, Name = className, Position = Vector3.new(0, 0, 0) }
end
local task = {}
function task.wait(s) return s or 0 end
function task.spawn(fn, ...) if type(fn) == "function" then fn(...) end end
function task.defer(fn, ...) if type(fn) == "function" then fn(...) end end
_G.Vector3 = Vector3
_G.Instance = Instance
_G.task = task
`;

self.onmessage = async function (e) {
  const data = e.data;
  if (data.type === "init") {
    await initVM();
    return;
  }
  if (data.type !== "run") return;

  if (!isReady || !moduleInstance) {
    postMessage({ type: "run_result", token: data.token, exitCode: -99, stdout: [], stderr: [], error: "VM not initialized" });
    return;
  }

  stdoutBuffer = [];
  stderrBuffer = [];
  const fullCode = mockHeader + "\n" + data.code;

  try {
    const compileAndRun = moduleInstance.cwrap("luau_compile_and_run", "number", ["string"]);
    const exitCode = compileAndRun(fullCode);
    postMessage({ type: "run_result", token: data.token, exitCode, stdout: stdoutBuffer, stderr: stderrBuffer });
  } catch (err) {
    postMessage({ type: "run_result", token: data.token, exitCode: -99, stdout: stdoutBuffer, stderr: stderrBuffer, error: err.message || String(err) });
  }
};

initVM();
