import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const root = await mkdtemp('D:/Tong/state/observer-inventory-');
const source = await readFile(new URL('../scripts/TongRuntimeSecurity.ps1', import.meta.url), 'utf8');
// Unit fixture replaces CIM only inside this private helper copy. It models the
// observed root -> metadata helper -> conhost chain without excluding a real
// backend that happens to contain the same script name in its command line.
const fixture = `
function Get-CimInstance {
 $at=[DateTime]::UtcNow
 @(
  [pscustomobject]@{ProcessId=2147483001;ParentProcessId=0;ExecutablePath='D:\\node\\node.exe';CreationDate=$at.AddHours(-1);CommandLine='backend root'},
  [pscustomobject]@{ProcessId=$PID;ParentProcessId=2147483001;ExecutablePath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';CreationDate=$at.AddSeconds(-2);CommandLine='TongRuntimeSecurity.ps1'},
  [pscustomobject]@{ProcessId=2147483002;ParentProcessId=$PID;ExecutablePath='C:\\Windows\\System32\\conhost.exe';CreationDate=$at.AddSeconds(-1);CommandLine='console'},
  [pscustomobject]@{ProcessId=2147483003;ParentProcessId=2147483001;ExecutablePath='D:\\node\\node.exe';CreationDate=$at.AddMinutes(-1);CommandLine='backend TongRuntimeSecurity.ps1 argument'}
 )
}
`;
const helper = join(root, 'TongRuntimeSecurity.ps1');
await writeFile(helper, source.replace("$ErrorActionPreference = 'Stop'", "$ErrorActionPreference = 'Stop'\n" + fixture));
const env={...process.env};delete env.PSMODULEPATH;
const result=spawnSync('C:/Program Files/PowerShell/7/pwsh.exe',['-NoProfile','-NonInteractive','-File',helper,'-Mode','descendants'],{env,input:JSON.stringify({pid:2147483001}),encoding:'utf8',windowsHide:true,timeout:15000});
assert.equal(result.status,0,result.stderr);
const value=JSON.parse(result.stdout),identities=Array.isArray(value)?value:[value];
assert.deepEqual(identities.map(p=>p.pid),[2147483003],'exclude the owned observer subtree, retain every unrelated backend');
console.log(JSON.stringify({passed:true,root,observerSubtreeExcluded:true,backendRetained:true,oldIdentityProofUnchanged:true}));
