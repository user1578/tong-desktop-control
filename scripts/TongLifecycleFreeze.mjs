import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, lstat, realpath, open, unlink } from 'node:fs/promises';
import { join, resolve, isAbsolute,dirname,relative,sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reviewed modules in App/Manager can have different physical module URLs.
// Share the in-process capability, never an environment/CLI bypass token.
const key=Symbol.for('tong.lifecycle.freeze.v1');
const shared=globalThis[key]??=Object.freeze({context:new AsyncLocalStorage(),borrowed:new WeakSet()});
const {context,borrowed}=shared;
const fail = code => new Error(code), sha = data => createHash('sha256').update(data).digest('hex');
const helper = fileURLToPath(new URL('TongLifecycleFreeze.ps1', import.meta.url));
const gate = root => join(root, 'run', 'backup.freeze');
export function maintenanceFreeze(root) {
  const lease = context.getStore();
  return lease?.root === resolve(root) && !lease.closed ? lease : null;
}
export async function acquireRuntimeFreeze(root) {
  const lease = maintenanceFreeze(root);
  if (!lease) return open(gate(root), 'wx');
  await lease.proof();
  const handle = { close: async () => { await lease.proof(); } };
  borrowed.add(handle); return handle;
}
export async function releaseRuntimeFreeze(root, handle) {
  if (borrowed.has(handle)) { await handle.close(); return; }
  await handle.close(); await unlink(gate(root));
}
export async function authorizeProductionUpgrade(profile,productionUpgrade){
  const {validateProductionProfile,verifyRuntimeApproval}=await import('./TongProductionProfile.mjs');
  profile=validateProductionProfile(profile);
  const baseline=validateProductionProfile(productionUpgrade?.baselineProfile);
  if(profile.mode!=='production'||baseline.mode!=='production'||baseline.root!==profile.root)throw fail('LIFECYCLE_BINDING_DENIED');
  await verifyRuntimeApproval(baseline,'restore');await verifyRuntimeApproval(profile,'start');await verifyRuntimeApproval({...profile,agentdockEnabled:false},'manager');
}
export async function withMaintenanceFreeze(profile, { expectedSha256, productionUpgrade,upgradeReceipt,testCrashAfterReceipt=false }, action) {
  // The production adapter remains review-gated. Check before all filesystem I/O.
  if (profile?.mode !== 'production-simulation' && !(profile?.mode==='production'&&productionUpgrade)) throw fail('MAINTENANCE_NOT_READY');
  const { validateProductionProfile } = await import('./TongProductionProfile.mjs');
  profile = validateProductionProfile(profile);
  if(profile.mode==='production'){
    // The ordinary local signer binds both versions. Recovery grants cannot
    // authorize this deployment lease or pin/code mutation.
    await authorizeProductionUpgrade(profile,productionUpgrade);
    if(testCrashAfterReceipt)throw fail('LIFECYCLE_BINDING_DENIED');
  }
  const root = resolve(profile.root);
  if (context.getStore()) throw fail('LIFECYCLE_REENTRANT_MAINTENANCE_DENIED');
  if (!isAbsolute(root) || typeof action !== 'function' || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? '')) throw fail('LIFECYCLE_BINDING_DENIED');
  if(upgradeReceipt){
    if(!isAbsolute(upgradeReceipt))throw fail('LIFECYCLE_BINDING_DENIED');
    const allowed=profile.mode==='production'?'D:\\Tong\\state\\p27-autonomy-candidate-20261017':root;
    const rel=relative(allowed,upgradeReceipt);if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw fail('LIFECYCLE_BINDING_DENIED');
  }
  for (const path of [root, join(root, 'run'), ...(upgradeReceipt?[dirname(upgradeReceipt)]:[gate(root)])]) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1 || (await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()) throw fail('LIFECYCLE_PATH_DENIED');
  }
  if (!upgradeReceipt&&sha(await readFile(gate(root))) !== expectedSha256) throw fail('LIFECYCLE_FREEZE_CHANGED');
  const env = { ...process.env }; delete env.PSMODULEPATH;
  const child = spawn(join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper], { windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', pending, ended = false, chain = Promise.resolve();
  child.stderr.resume(); child.stdin.on('error', () => {});
  const abort = () => { ended = true; pending?.reject(fail('LIFECYCLE_FREEZE_UNAVAILABLE')); pending = null; };
  child.once('error', abort); child.once('close', abort);
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 4096) { child.kill(); return abort(); }
    const index = buffer.indexOf('\n');
    if (index >= 0 && pending) { const wait = pending; pending = null; const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); try { wait.resolve(JSON.parse(line)); } catch { wait.reject(fail('LIFECYCLE_FREEZE_UNAVAILABLE')); } }
  });
  const receive = command => new Promise((resolve, reject) => {
    if (ended || pending) return reject(fail('LIFECYCLE_FREEZE_UNAVAILABLE'));
    const timer = setTimeout(() => { child.kill(); reject(fail('LIFECYCLE_FREEZE_UNAVAILABLE')); }, 10000);
    pending = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
    child.stdin.write(command + '\n');
  });
  const check = proof => { if (proof?.root !== root || proof.sha256 !== expectedSha256 || proof.holderPid !== child.pid || proof.exclusiveWriter !== true) throw fail('LIFECYCLE_BINDING_DENIED'); return proof; };
  const lease = { root, closed: false, proof: () => { chain = chain.then(async () => check(await receive('proof'))); return chain; },
    ...(upgradeReceipt?{release:async()=>{const result=await receive('release');if(result?.released!==true)throw fail('LIFECYCLE_FREEZE_UNAVAILABLE');return result;}}:{}) };
  try {
    check(await receive(JSON.stringify({ root, expectedSha256,...(upgradeReceipt?{upgradeReceipt,profile,productionUpgrade,testCrashAfterReceipt}:{} ) })));
    return await context.run(lease, () => action(lease));
  } finally {
    lease.closed = true;
    const closed = ended ? Promise.resolve() : new Promise(resolve => child.once('close', resolve));
    child.stdin.end('close\n');
    await closed; // EOF on controller death also releases the kernel handle.
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--authorize-upgrade'){
  try{let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>65536)throw fail('LIFECYCLE_BINDING_DENIED');}const value=JSON.parse(input);await authorizeProductionUpgrade(value.profile,value.productionUpgrade);console.log(JSON.stringify({verified:true}));}
  catch{process.exitCode=2;}
}
