import { spawn } from 'node:child_process';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { validateProductionProfile, productionProfileDigest } from './TongProductionProfile.mjs';
import { assertProtectedPaths, processIdentity } from './TongRuntimeSecurity.mjs';

const helper = fileURLToPath(new URL('Tong024Handoff.ps1', import.meta.url));
const sha = data => createHash('sha256').update(data).digest('hex');
const fail = code => new Error(code);
const id = value => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value ?? '');
const borrowed = new WeakSet();
function launch(mode) {
  const env = { ...process.env }; delete env.PSMODULEPATH;
  // Startup uses safeEnvironment, which intentionally omits ProgramFiles.
  return spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper, '-Mode', mode], { windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
}
async function ordinary(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1 || (await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()) throw fail('HANDOFF_PATH_DENIED');
}
export function is024Borrowed(handle) { return borrowed.has(handle); }
export async function recover024Freeze(input,{sessionId,snapshotSha256,gateSha256}) {
  if(input?.mode!=='production-simulation')throw fail('MAINTENANCE_NOT_READY');
  const profile=validateProductionProfile(input),root=profile.root;
  if(!id(sessionId)||![snapshotSha256,gateSha256].every(value=>/^[a-f0-9]{64}$/.test(value??'')))throw fail('HANDOFF_BINDING_DENIED');
  for(const path of [root,join(root,'run'),join(root,'run/backup.freeze'),join(root,'024-handoff'),join(root,'024-handoff',sessionId),join(root,'024-handoff',sessionId,'snapshot.json'),join(root,'024-handoff',sessionId,'original.freeze')])await ordinary(path);
  await assertProtectedPaths([root,join(root,'run'),join(root,'run/backup.freeze')]);
  const child=launch('recover');let stdout='',stderr='',proof,parseError;
  child.stdout.on('data',b=>{stdout+=b;let end;while((end=stdout.indexOf('\n'))>=0){const line=stdout.slice(0,end);stdout=stdout.slice(end+1);try{const value=JSON.parse(line);if(['recovery-prepared','freeze-written'].includes(value.phase))child.stdin.write('continue\n');else proof=value;}catch(error){parseError=error;child.kill();}}});child.stderr.on('data',b=>stderr+=b);child.stdin.on('error',()=>{});
  child.stdin.write(JSON.stringify({root,mode:profile.mode,profileDigest:productionProfileDigest(profile),sessionId,snapshotSha256,gateSha256})+'\n');
  const timer=setTimeout(()=>child.kill(),10000);const code=await new Promise((ok,reject)=>{child.once('error',reject);child.once('close',ok);});clearTimeout(timer);
  if(code!==0){let reason;try{reason=JSON.parse(stderr).error;}catch{}throw fail(/^HANDOFF_[A-Z_]+$/.test(reason??'')?reason:'HANDOFF_NATIVE_REFUSED');}
  if(parseError||proof?.phase!=='freeze-restored'||proof.sessionId!==sessionId)throw fail('HANDOFF_NATIVE_REFUSED');return proof;
}
export async function borrow024Handoff(root, { sessionId, profile, action }) {
  profile = validateProductionProfile(profile);
  if (profile.root !== root || !id(sessionId) || !['start', 'stop-run', 'probe'].includes(action) || action === 'probe' && profile.mode !== 'production-simulation') throw fail('HANDOFF_BINDING_DENIED');
  await assertProtectedPaths([root, join(root, 'run'), join(root, 'run/backup.freeze')]);
  const child = launch('proof'); let out = '', err = '';
  child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({ root, sessionId, profileDigest: productionProfileDigest(profile), pid: process.pid, role: 'manager', action }) + '\n');
  const timer = setTimeout(() => child.kill(), 10000);
  const code = await new Promise((ok, reject) => { child.once('error', reject); child.once('close', ok); }); clearTimeout(timer);
  if (code !== 0 || err || out.length > 8192) throw fail('HANDOFF_CALLER_DENIED');
  const proof = JSON.parse(out);
  if (!proof.verified || proof.sessionId !== sessionId || proof.caller.pid !== process.pid) throw fail('HANDOFF_CALLER_DENIED');
  const handle = { close: async () => {}, proof }; borrowed.add(handle); return handle;
}

// A separate reviewed execution gate remains in force. This native primitive
// cannot write the production root, even when called directly without an adapter.
export async function open024Handoff(input, { expectedSha256, sessionId = randomUUID() } = {}) {
  if (input?.mode !== 'production-simulation') throw fail('MAINTENANCE_NOT_READY');
  const profile = validateProductionProfile(input), root = profile.root;
  if (!id(sessionId) || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? '')) throw fail('HANDOFF_BINDING_DENIED');
  for (const path of [root, join(root, 'run'), join(root, 'run/backup.freeze'), profile.managerRoot]) await ordinary(path);
  try { await ordinary(join(root,'024-handoff')); } catch(error) { if(error.code!=='ENOENT')throw error; }
  await assertProtectedPaths([root, join(root, 'run'), join(root, 'run/backup.freeze')]);
  if ((await readFile(join(root, 'run/backup.freeze'))).length !== 0) throw fail('HANDOFF_RECOVERY_REQUIRED');
  const controller = await processIdentity(process.pid);
  const child = launch('host'); let buffer = '', pending, ended = false, stderr = '';
  child.stdin.on('error', () => {}); child.stderr.on('data', data => { stderr += data; });
  const closed = new Promise(resolve => child.once('close', code => { ended = true; pending?.reject(fail('HANDOFF_NATIVE_REFUSED')); pending = null; resolve(code); }));
  child.once('error', () => { ended = true; pending?.reject(fail('HANDOFF_NATIVE_REFUSED')); });
  child.stdout.on('data', data => {
    buffer += data;
    if (buffer.length > 32768) { child.kill(); return; }
    const end = buffer.indexOf('\n');
    if (end >= 0 && pending) { const p = pending; pending = null; const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); try { p.resolve(JSON.parse(line)); } catch { p.reject(fail('HANDOFF_NATIVE_REFUSED')); } }
  });
  function rpc(request) {
    return new Promise((resolve, reject) => {
      if (ended || pending) return reject(fail('HANDOFF_NATIVE_REFUSED'));
      const timer = setTimeout(() => { child.kill(); reject(fail('HANDOFF_NATIVE_REFUSED')); }, 10000);
      pending = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
      child.stdin.write(JSON.stringify(request) + '\n');
    });
  }
  try {
    const proof = await rpc({ root, mode: profile.mode, sessionId, expectedSha256, profileDigest: productionProfileDigest(profile), releaseDigest: profile.releaseDigest, controller, managerRoot: profile.managerRoot, nodeExe: process.execPath });
    return {
      sessionId, proof, helperPid: child.pid,
      async prove() { return rpc({ command: 'proof' }); },
      async launch(action, { loginRecovery = false, runId } = {}) {
        const entry = join(profile.managerRoot, 'scripts/TongAgentDockRuntime.mjs'); await ordinary(entry);
        return rpc({ command: 'launch', action, loginRecovery, ...(runId ? { runId } : {}), scriptSha256: sha(await readFile(entry)) });
      },
      async cancel() { return rpc({ command: 'cancel' }); },
      async restoreFreeze() { const value = await rpc({ command: 'restore-freeze' }); assertExit(await closed); return value; },
      async complete(runId, monitor) { const value = await rpc({ command: 'complete', runId, monitor }); assertExit(await closed); return value; },
      async close() { if (!ended) child.stdin.end(); return closed; },
      diagnostics: () => ({ stderr, ended }),
    };
  } catch (error) { child.stdin.end(); await closed; error.nativeStderr = stderr; throw error; }
}
function assertExit(code) { if (code !== 0) throw fail('HANDOFF_NATIVE_REFUSED'); }
