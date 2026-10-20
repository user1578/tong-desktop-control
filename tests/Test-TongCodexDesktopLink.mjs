import assert from "node:assert/strict";
import { openCodexDesktopThread } from "../scripts/TongCodexDesktopLink.mjs";

const threadId = "01a15947-8cc6-7353-93a9-5daa57f83706";
const calls = [];
const fakeExecute = (file, args, options, callback) => {
  calls.push({ file, args, options });
  callback(null);
};
assert.equal(await openCodexDesktopThread(threadId, { platform: "win32", execute: fakeExecute }), true);
assert.equal(calls.length, 1);
assert.equal(calls[0].file, "pwsh");
assert.equal(calls[0].args[0], "-NoProfile");
assert.ok(calls[0].args.at(-1).includes(`codex://threads/${threadId}`));
assert.equal(calls[0].options.windowsHide, true);
assert.equal(await openCodexDesktopThread(threadId, { platform: "linux", execute: fakeExecute }), false);
assert.equal(await openCodexDesktopThread("thread-simulated", { platform: "win32", execute: fakeExecute }), false);
assert.equal(await openCodexDesktopThread(`${threadId}';exit 1`, { platform: "win32", execute: fakeExecute }), false);
assert.equal(calls.length, 1, "invalid or non-Windows requests must never dispatch");
await assert.rejects(openCodexDesktopThread(threadId, {
  platform: "win32", execute: (_file, _args, _options, callback) => callback(new Error("handler unavailable")),
}), /handler unavailable/);
console.log("Codex Desktop deep-link helper tests passed.");
