import assert from "node:assert/strict";
import { notifyWindowsTask } from "../scripts/TongWindowsTaskNotice.mjs";

const calls = [];
const execute = (program, args, options, callback) => {
  calls.push({ program, args, options });
  queueMicrotask(() => callback(null));
};

assert.equal(await notifyWindowsTask({ projectId: "travelguard", status: "success" }, { platform: "win32", execute }), true);
assert.equal(calls.length, 1);
assert.equal(calls[0].program, "pwsh");
assert.equal(calls[0].options.windowsHide, true);
assert.equal(calls[0].args.at(-3), "travelguard");
assert.equal(calls[0].args.at(-1), "success");
for (const spec of [
  { projectId: "travelguard'; exit 1;", status: "success" },
  { projectId: "travelguard", status: "running" },
]) assert.equal(await notifyWindowsTask(spec, { platform: "win32", execute }), false);
assert.equal(await notifyWindowsTask({ projectId: "travelguard", status: "failed" },
  { platform: "linux", execute }), false);
assert.equal(calls.length, 1);
await assert.rejects(notifyWindowsTask({ projectId: "travelguard", status: "failed" },
  { platform: "win32", execute: (_program, _args, _opts, done) => done(new Error("No notification session")) }), /notification session/);
console.log("PASS: Windows task notification is bounded, Windows-only and rejects injected arguments.");
