import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Exercise the real envelope validator without a runtime instance, code archive,
// dependency copy or backup/restore operation. No production interface is added.
const source=await readFile(new URL('../scripts/TongRuntimeBackup.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function ciphertextOnly('),end=source.indexOf('async function snapshotCode(',start);
assert.ok(start>=0&&end>start);
const validate=runInNewContext('('+source.slice(start,end)+')',{readFile,join,Buffer,fail:code=>new Error(code)});
const root=join('D:\\Tong\\state\\p26-cold-start-20261014','permission-backup-regression');
await mkdir(join(root,'secrets','runtime-permissions'),{recursive:true});
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()!=='PSMODULEPATH'));
const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('synthetic backup validation'),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)); [Security.Principal.WindowsIdentity]::GetCurrent().User.Value"],{env,encoding:'utf8',windowsHide:true});
assert.equal(result.status,0,result.stderr);
const [ciphertext,userSid]=result.stdout.trim().split(/\r?\n/),suffix=randomUUID();
const envelope=purpose=>({schemaVersion:1,purpose,scope:'CurrentUser',userSid,ciphertext});
async function fixture(name,value){await writeFile(join(root,...name.split('/')),JSON.stringify(value));return [{path:name}];}
const ordinary='secrets/agentdock-'+suffix+'.dpapi';
await validate(root,await fixture(ordinary,envelope('agentdock')));
const receipt='secrets/runtime-permissions/'+'a'.repeat(64)+'.start.dpapi.json';
const recovery='secrets/runtime-permissions/production.login-recovery.current.dpapi.json';
await validate(root,await fixture(receipt,envelope('tong-runtime-permission')));
await validate(root,await fixture(recovery,envelope('tong-login-recovery')));
await assert.rejects(validate(root,await fixture(receipt,envelope('agentdock'))),/CIPHERTEXT_REQUIRED/);
await assert.rejects(validate(root,await fixture(recovery,envelope('tong-runtime-permission'))),/CIPHERTEXT_REQUIRED/);
await assert.rejects(validate(root,await fixture('secrets/foreign-'+suffix+'.dpapi',envelope('tong-runtime-permission'))),/CIPHERTEXT_REQUIRED/);
await assert.rejects(validate(root,await fixture('secrets/runtime-permissions/production.login-recovery.audit.jsonl',{})),/CIPHERTEXT_REQUIRED/);
await assert.rejects(validate(root,await fixture(receipt,{...envelope('tong-runtime-permission'),ciphertext:Buffer.from('plaintext').toString('base64')})),/CIPHERTEXT_REQUIRED/);
console.log(JSON.stringify({passed:true,root,permissionCiphertextAccepted:true,wrongPurposeAndPlaintextDenied:true,backupCreated:false}));
