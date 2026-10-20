import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { notifyWindowsTask } from "../scripts/TongWindowsTaskNotice.mjs";

const calls = [];
let detached = 0;
const launch = (program, args, options) => {
  calls.push({ program, args, options });
  const child = new EventEmitter();
  child.unref = () => { detached++; };
  queueMicrotask(() => child.emit("spawn"));
  return child;
};

assert.equal(await notifyWindowsTask({ projectId: "travelguard", status: "success" },
  { platform: "win32", launch }), true);
assert.equal(calls.length, 1);
assert.equal(calls[0].program, "pwsh");
assert.equal(calls[0].options.windowsHide, true);
assert.equal(calls[0].options.detached, true);
assert.equal(calls[0].args.includes("-Sta"), true);
assert.equal(calls[0].args.at(-3), "travelguard");
assert.equal(calls[0].args.at(-1), "success");
assert.equal(detached, 1);
for (const spec of [
  { projectId: "travelguard'; exit 1;", status: "success" },
  { projectId: "travelguard", status: "running" },
]) assert.equal(await notifyWindowsTask(spec, { platform: "win32", launch }), false);
assert.equal(await notifyWindowsTask({ projectId: "travelguard", status: "failed" },
  { platform: "linux", launch }), false);
assert.equal(calls.length, 1);
await assert.rejects(notifyWindowsTask({ projectId: "travelguard", status: "failed" },
  { platform: "win32", launch: () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("error", new Error("No interactive session")));
    return child;
  }}), /interactive session/);
console.log("PASS: Windows completion card launches detached, validates inputs, and cannot delay task completion.");
