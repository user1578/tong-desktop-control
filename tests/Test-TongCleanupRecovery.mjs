import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,stat,rename,symlink,readdir,lstat,appendFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createTongTestDirectory} from './fixtures/TongTestDirectory.mjs';
import {TongManagedCleanup} from '../scripts/TongManagedCleanup.mjs';
import {prepareCleanupSelection,executeCleanupSelection} from '../scripts/TongCleanupSelection.mjs';
import {closeCleanupNative} from '../scripts/TongCleanupNative.mjs';
const fixture=await createTongTestDirectory('tong-cleanup-recovery-');let passed=false;
try{
 const root=join(fixture.path,'root'),store=join(fixture.path,'store');await mkdir(root);await mkdir(store);
 const grant={id:'synthetic',root,enabled:true,revision:'initial',scopes:[{relativeRoot:'.',categories:['cache']}]},save=()=>writeFile(join(store,'disk-cleanup-grants.json'),JSON.stringify({schemaVersion:1,grants:[grant]}));await save();
 const access={listProjects:async()=>[{id:'synthetic',root,status:'enabled',available:true,effectiveCapabilities:['project.read','project.write']}]},manager=new TongManagedCleanup({access,stateDir:store});
 const make=async name=>{const p=join(root,name);await mkdir(p);await writeFile(join(p,'a.pyc'),'a');await writeFile(join(p,'b.pyc'),'b');return p;};
 const cache=await make('__pycache__'),plan=await prepareCleanupSelection(manager,{projectId:'synthetic',path:cache}),journal=join(store,'interrupted.jsonl');
 const cancel=Error('stop');cancel.code='CLEANUP_CANCELLED';
 await assert.rejects(executeCleanupSelection(manager,plan,{journalPath:journal,progress:async p=>{if(p.deletedFiles===1)throw cancel;}}),/stop/);
 assert.equal((await readdir(cache)).length,1);
 await appendFile(journal,'{"event":"torn');
 const resumed=await executeCleanupSelection(manager,plan,{journalPath:journal});assert.equal(resumed.files,2);await assert.rejects(stat(cache),{code:'ENOENT'});
 // Replaying completion after the root disappeared never deletes new paths.
 assert.equal((await executeCleanupSelection(manager,plan,{journalPath:journal})).files,2);
 const records=(await readFile(journal,'utf8')).trim().split('\n');
 await writeFile(journal,records.filter(l=>!l.includes('cleanup_result')).join('\n')+'\n');
 assert.equal((await executeCleanupSelection(manager,plan,{journalPath:journal})).reconciled,true);
 const revoke=await make('node-compile-cache'),revokePlan=await prepareCleanupSelection(manager,{projectId:'synthetic',path:revoke});
 await assert.rejects(executeCleanupSelection(manager,revokePlan,{journalPath:join(store,'revoke.jsonl'),progress:async p=>{if(p.deletedFiles===1){grant.enabled=false;await save();}}}),/CLEANUP_(?:PERMISSION_CHANGED|PERMISSION_REQUIRED)/);
 assert.equal((await readdir(revoke)).length,1);grant.enabled=true;await save();
 // A genuinely locked file is skipped; its peer is deleted, and a later resume
 // retries the same verified selection after the holder closes.
 const locked=await make('.ruff_cache'),holdScript=join(fixture.path,'hold.ps1');
 await writeFile(holdScript,"param([string]$Path)\n$h=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)\ntry{[Console]::WriteLine('READY');[Console]::ReadLine()>$null}finally{$h.Dispose()}\n");
 const holder=spawn('C:\\Program Files\\PowerShell\\7\\pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',holdScript,join(locked,'b.pyc')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const holderClosed=new Promise(resolve=>holder.once('close',resolve));
 await new Promise((resolve,reject)=>{holder.stdout.once('data',b=>b.toString().includes('READY')?resolve():reject(Error('holder protocol')));holder.once('error',reject);});
 const lockedPlan=await prepareCleanupSelection(manager,{projectId:'synthetic',path:locked}),lockedJournal=join(store,'locked.jsonl');
 try{const partial=await executeCleanupSelection(manager,lockedPlan,{journalPath:lockedJournal});assert.equal(partial.files,1);assert.equal(partial.skipped.length,1);}finally{holder.stdin.end('\n');await holderClosed;}
 const retried=await executeCleanupSelection(manager,lockedPlan,{journalPath:lockedJournal});assert.equal(retried.files,2);assert.equal(retried.skipped.length,0);
 // Exact ordinary deletion reuses project.write; protected directory roots stay.
 const ordinary=join(root,'ordinary');await mkdir(ordinary);await writeFile(join(ordinary,'plain.txt'),'explicitly requested');await writeFile(join(ordinary,'AGENTS.md'),'retain');
 const exact=await prepareCleanupSelection(manager,{projectId:'synthetic',path:ordinary,exact:true});const x=await executeCleanupSelection(manager,exact,{journalPath:join(store,'exact.jsonl')});assert.equal(x.files,1);assert.equal(await readFile(join(ordinary,'AGENTS.md'),'utf8'),'retain');
 const account=join(root,'profile');await mkdir(account);await writeFile(join(account,'NTUSER.DAT'),'account');
 await assert.rejects(prepareCleanupSelection(manager,{projectId:'synthetic',path:account,exact:true}),/CLEANUP_PROTECTED_PATH/);
 const single=join(root,'ordinary.txt');await writeFile(single,'remove this exact file');
 const one=await prepareCleanupSelection(manager,{projectId:'synthetic',path:single,exact:true});assert.equal((await executeCleanupSelection(manager,one,{journalPath:join(store,'one.jsonl')})).files,1);
 // Swap a checked parent for a junction after intent, before native deletion.
 const race=join(root,'.pytest_cache'),old=join(root,'original-race-parent'),outside=join(fixture.path,'outside');await mkdir(race);await mkdir(outside);await writeFile(join(race,'a.pyc'),'same');await writeFile(join(outside,'a.pyc'),'same');
 const racePlan=await prepareCleanupSelection(manager,{projectId:'synthetic',path:race}),raceJournal=join(store,'race.jsonl');let swapped=false;
 await assert.rejects(executeCleanupSelection(manager,racePlan,{journalPath:raceJournal,check:async()=>{if(swapped)return;let text='';try{text=await readFile(raceJournal,'utf8');}catch{}if(text.includes('delete_intent')){swapped=true;await rename(race,old);await symlink(outside,race,'junction');}}}),/CLEANUP_(?:UNSAFE_ITEM|REPARSE_PATH|TARGET_CHANGED)/);
 assert.equal(await readFile(join(outside,'a.pyc'),'utf8'),'same');assert.equal(await readFile(join(old,'a.pyc'),'utf8'),'same');
 console.log('PASS: interrupted deletion and torn journal recovery, missing-root reconciliation, per-file revocation, exact paths, protected root and junction swap rejection.');passed=true;
}finally{await closeCleanupNative();await fixture.finish(passed);}
