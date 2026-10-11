import { spawn } from 'node:child_process';
import { readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
const helper = fileURLToPath(new URL('TongRuntimeSecurity.ps1', import.meta.url));
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const fail = code => new Error(code);
export function safeEnvironment(root) {
  const keys = new Set(['SYSTEMROOT','WINDIR','COMSPEC','SYSTEMDRIVE','PROGRAMDATA','PATH','PATHEXT','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => keys.has(key.toUpperCase())));
  return { ...env, TEMP: join(root, 'temp'), TMP: join(root, 'temp'), USERPROFILE: join(root, 'home'), APPDATA: join(root, 'home', 'AppData', 'Roaming'), LOCALAPPDATA: join(root, 'home', 'AppData', 'Local') };
}
function launch(mode, input, root) {
  // Keep metadata inspection read-only: synthetic USERPROFILE/TEMP made Windows
  // create directories while inspecting an otherwise empty target.
  const keys = new Set(['SYSTEMROOT','WINDIR','COMSPEC','SYSTEMDRIVE','PROGRAMDATA','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => keys.has(key.toUpperCase())));
  const child = spawn(powershell, ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Mode',mode], { windowsHide: true, env, stdio: ['pipe','pipe','pipe'] });
  child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(input)); return child;
}
async function run(mode, input, root = dirname(helper)) {
  const child = launch(mode, input, root); let out = '', size = 0;
  child.stdout.on('data', chunk => { size += chunk.length; if (size > 1048576) child.kill(); else out += chunk; });
  child.stderr.resume();
  return new Promise((ok, reject) => {
    const timer = setTimeout(() => child.kill(), 20000);
    child.once('error', () => { clearTimeout(timer); reject(fail('SECURITY_UNAVAILABLE')); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0 || size > 1048576) reject(fail('SECURITY_UNAVAILABLE')); else { try { ok(out.trim() ? JSON.parse(out) : []); } catch { reject(fail('SECURITY_UNAVAILABLE')); } } });
  });
}
export async function inspectSecurity(paths) {
  if (process.platform !== 'win32' || !Array.isArray(paths) || !paths.length || paths.some(path => !isAbsolute(path))) throw fail('ACL_DENIED');
  for (const path of paths) { const info = await lstat(path); if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1 || (await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()) throw fail('ACL_DENIED'); }
  return run('acl', { paths }, paths[0]);
}
export async function assertProtectedPaths(paths) {
  const info = await inspectSecurity(paths);
  if (info.items.length !== paths.length || info.items.some(item => !item.secure)) throw fail('ACL_DENIED');
  return info;
}
function secretPath(root, purpose) {
  if (!['agentdock','oauth-owner'].includes(purpose)) throw fail('SECRET_UNAVAILABLE');
  return join(root, 'secrets', purpose + '.dpapi');
}
export async function protectSecret(root, purpose, value) {
  const path = secretPath(root, purpose);
  await assertProtectedPaths([root, dirname(path)]);
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(value)) throw fail('SECRET_UNAVAILABLE');
  const encrypted = await run('protect', { purpose, value }, root);
  try { await writeFile(path, JSON.stringify(encrypted) + '\n', { flag: 'wx' }); }
  catch (error) { throw fail(error.code === 'EEXIST' ? 'SECRET_EXISTS' : 'SECRET_UNAVAILABLE'); }
  await assertProtectedPaths([path]);
}
export async function readSecret(root, purpose) {
  const path = secretPath(root, purpose); await assertProtectedPaths([root, dirname(path), path]);
  const pipeName = 'tong-dpapi-' + randomBytes(24).toString('hex');
  const child = launch('unprotect', { path, purpose, pipeName }, root);
  child.stderr.resume();
  return new Promise((ok, reject) => {
    let socket, done = false, output = '', bytes = Buffer.alloc(0);
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); socket?.destroy(); if (error) { child.kill(); reject(fail('SECRET_UNAVAILABLE')); } else ok(value); };
    const timer = setTimeout(() => finish(true), 15000);
    child.once('error', () => finish(true));
    child.stdout.on('data', chunk => {
      output += chunk; if (output.length > 100) return finish(true);
      if (!socket && /^READY\r?\n/.test(output)) {
        socket = connect('\\\\.\\pipe\\' + pipeName);
        socket.once('error', () => finish(true));
        socket.on('data', data => { bytes = Buffer.concat([bytes, data]); if (bytes.length > 128) finish(true); });
        socket.once('end', () => { const value = bytes.toString('utf8'); bytes.fill(0); if (!/^[a-zA-Z0-9_-]{32,128}$/.test(value)) finish(true); else finish(false, value); });
      }
    });
    child.once('close', code => { if (code !== 0 || !socket) finish(true); });
  });
}
export async function processIdentity(pid, marker = '') { return run('identity', { pid, marker }); }
export function sameProcess(actual, expected) { return !!actual && actual.pid === expected?.pid && actual.exe?.toLowerCase() === expected.exe?.toLowerCase() && actual.startTicks === expected.startTicks; }
export async function processDescendants(pid) { const result = await run('descendants', { pid }); return Array.isArray(result) ? result : result ? [result] : []; }
export async function terminateOwnedProcess(identity) { return run('terminate', identity); }
export function exitDiagnostic(code, signal = null) {
  return { exitCode: code, signal, hex: Number.isInteger(code) ? '0x' + (code >>> 0).toString(16).toUpperCase().padStart(8, '0') : null,
    classification: (code >>> 0) === 0xC0000409 ? 'native_fast_fail' : code === 0 ? 'normal_exit' : 'abnormal_exit' };
}
