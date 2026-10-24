// Explicitly read-only production inspection. Never unseals a credential or
// calls login-recovery, start, stop, init, pin, backup, restore or task control.
import assert from 'node:assert/strict';
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { verifyRuntimeCandidate } from '../scripts/TongRuntimeCandidate.mjs';
import { validateProductionProfile } from '../scripts/TongProductionProfile.mjs';
import { processIdentity, sameProcess, startupJobsState, runtimeProcessInventory, processDescendants } from '../scripts/TongRuntimeSecurity.mjs';
import { runtimeStatus } from '../scripts/TongAgentDockRuntime.mjs';
import { incident } from '../scripts/Tong024LegacyRecovery.mjs';

const root = 'D:\\Tong\\runtime', sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const profile = validateProductionProfile(await readJson(join(root, 'profile.json')));
assert.equal(profile.root, root);
const records = {};
for (const name of ['runtime', 'guardian', 'request', 'abort']) records[name] = await readJson(join(root, 'run', name + '.json'));
const pin = await readJson(join(root, 'run/release-pin.json'));
const managerPin = await readJson(join(root, 'run/manager-pin.json'));
assert.equal(pin.commit, incident.baselineCommit); assert.equal(managerPin.commit, incident.baselineCommit);

async function fingerprints() {
  const files = ['profile.json', 'production-root.json', 'logs/maintenance-transaction.json', 'logs/login-management.jsonl', 'logs/lifecycle.jsonl'];
  // Only hash DPAPI envelopes. No envelope parsing, unprotect or plaintext.
  for (const folder of ['run', 'secrets/runtime-permissions', 'login-management']) {
    for (const item of await readdir(join(root, folder), { withFileTypes: true })) {
      if (item.isFile()) files.push(folder + '/' + item.name);
      else if (!item.isDirectory()) throw Error('AUDIT_NON_REGULAR_PATH');
    }
  }
  const result = {};
  for (const name of files.sort()) {
    const path = join(root, name), info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || (await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()) throw Error('AUDIT_NON_REGULAR_PATH');
    result[name] = { size: info.size, sha256: sha(await readFile(path)) };
  }
  return result;
}
const before = await fingerprints(), bindings = {};
for (const manager of [false, true]) {
  try { bindings[manager ? 'manager' : 'app'] = await verifyRuntimeCandidate(profile, { manager, ...(manager ? { reviewedManagerProfile: { ...profile, agentdockEnabled: false } } : {}) }); }
  catch (error) { bindings[manager ? 'manager' : 'app'] = { verified: false, error: error.message }; }
}
const identities = [];
const owned = [records.guardian, records.runtime.supervisor, ...records.runtime.children, ...records.runtime.descendants];
for (const expected of owned.filter((id, index, list) => list.findIndex(other => other.pid === id.pid) === index)) {
  try {
    const actual = await processIdentity(expected.pid);
    const unknown = actual && (!actual.exe || !/^\d+$/.test(actual.startTicks ?? ''));
    identities.push({ pid: expected.pid, state: unknown ? 'UNKNOWN' : sameProcess(actual, expected) ? 'ALIVE' : actual ? 'PID_REUSED' : 'GONE' });
  } catch (error) { identities.push({ pid: expected.pid, state: 'UNKNOWN', error: error.message }); }
}
const jobs = {};
for (const runId of [incident.oldRunId, incident.firstFailedRunId, incident.failedRunId]) jobs[runId] = await startupJobsState(runId);
let inventory;
try { const value = await runtimeProcessInventory({ roots: [root, profile.codeRoot, profile.managerRoot], runIds: Object.keys(jobs), mode: 'production' }); inventory = { complete: value.complete, count: value.matchingProcesses.length }; }
catch (error) { inventory = { complete: false, error: error.message }; }
// Doctor can unseal a backend token if a concurrent runtime becomes ready.
// Keep this audit strictly metadata-only in every state, not just this sample.
const status = await runtimeStatus(root);
const observerDescendants = await processDescendants(process.pid);
const command = String.raw`
  $ErrorActionPreference='Stop'
  $ngrok=@(Get-CimInstance Win32_Process -Filter "Name='ngrok.exe'" | ForEach-Object {
    $parent=Get-CimInstance Win32_Process -Filter ('ProcessId='+$_.ParentProcessId)
    [ordered]@{pid=$_.ProcessId;parentPid=$_.ParentProcessId;createdAt=$_.CreationDate.ToUniversalTime().ToString('o');exeReadable=[bool]$_.ExecutablePath;commandReadable=[bool]$_.CommandLine;parentName=$parent.Name;parentCreatedAt=$parent.CreationDate.ToUniversalTime().ToString('o')}
  })
  $services=@(Get-CimInstance Win32_Service -Filter "Name='ngrok'" | Select-Object Name,State,StartMode,ProcessId)
  $tasks=@(Get-ScheduledTask | Where-Object TaskName -Match '^Tong' | ForEach-Object { $info=Get-ScheduledTaskInfo -InputObject $_;[ordered]@{name=$_.TaskName;state=$_.State.ToString();lastTaskResult=$info.LastTaskResult;lastRunTime=$info.LastRunTime.ToUniversalTime().ToString('o')} })
  $listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -In @(7676,7677,18765) | Select-Object LocalAddress,LocalPort,OwningProcess)
  $monitors=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and ($_.Name -eq 'TongLoginHost.exe' -or ($_.Name -in @('powershell.exe','pwsh.exe') -and $_.CommandLine -like '*D:\Tong\runtime*TongLoginRuntime.ps1*')) } | Select-Object ProcessId,ParentProcessId,Name)
  @{ngrok=$ngrok;services=$services;tasks=$tasks;listeners=$listeners;monitors=$monitors}|ConvertTo-Json -Depth 6 -Compress
`;
const child = spawn(join(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '', err = ''; child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
const timer = setTimeout(() => child.kill(), 30000);
const code = await new Promise((ok, reject) => { child.once('error', reject); child.once('close', ok); }); clearTimeout(timer);
assert.equal(code, 0, err);
const native = JSON.parse(out);
const lifecycle = (await readFile(join(root, 'logs/lifecycle.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
const shutdown = lifecycle.findLast(event => event.runId === incident.oldRunId && event.event === 'shutdown');
const after = await fingerprints(); assert.deepEqual(after, before, 'production evidence changed during read-only audit');
console.log(JSON.stringify({ observedAt: new Date().toISOString(), productionReadOnly: true, baseline: pin.commit, sourceFiles: pin.sourceFiles.length, nativeFiles: pin.native.length, bindings, identities, jobs, inventory, status: { phase: status.phase, supervisorAlive: status.supervisorAlive, guardianAlive: status.guardianAlive }, doctor: { probed: false, reason: 'READ_ONLY_NO_SECRET_UNSEAL' }, observerDescendantCount: observerDescendants.length, native, historicalShutdown: { at: shutdown?.at, reason: shutdown?.reason }, legacyGuardianContainmentPresent: 'containment' in records.guardian, legacyFailedRunReceiptPresent: Object.keys(before).some(name => name === 'run/launcher.' + incident.failedRunId + '.json'), hashes: Object.fromEntries(['profile.json', 'run/release-pin.json', 'run/manager-pin.json', 'run/runtime.json', 'run/guardian.json', 'run/request.json', 'run/abort.json', 'run/backup.freeze', 'logs/maintenance-transaction.json'].map(name => [name, before[name]])), hashedFileCount: Object.keys(before).length, encryptedEnvelopesHashedOnly: true, controlledFileSetSha256: sha(JSON.stringify(before)), controlledFilesUnchanged: true, productionExecutionAllowed: false }));
assert.ok(bindings.app.verified && bindings.manager.verified, 'production baseline binding failed');
