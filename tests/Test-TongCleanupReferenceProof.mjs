import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
const url=new URL('../scripts/TongManagedCleanup.mjs',import.meta.url);
const source=await readFile(url,'utf8');
const start=source.indexOf('async function assertNoRuntimeReferences(target){'),end=source.indexOf('async function safeAuthorizedRoot',start);
assert.ok(start>=0&&end>start);
let proof,exit=0;
const spawn=()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stdin=new EventEmitter();
 child.stdin.end=()=>queueMicrotask(()=>{child.stdout.emit('data',JSON.stringify(proof));child.emit('close',exit);});
 child.kill=()=>child.emit('close',1);return child;
};
const fail=code=>{throw Error(code);};
const code=source.slice(start,end).replaceAll('import.meta.url',JSON.stringify(url.href));
const check=new Function('within','fileURLToPath','spawn','fail',code+';return assertNoRuntimeReferences;')(()=>true,fileURLToPath,spawn,fail);
const warning={code:'TRUSTED_SYSTEM_COM_UNRESOLVED',classId:'{11111111-1111-4111-8111-111111111111}',task:'\\Microsoft\\Windows\\Synthetic\\Test'};
proof={readOnly:true,references:0,unknown:0,warnings:[warning]};
assert.deepEqual(await check('D:\\Tong\\state\\synthetic\\npm-cache'),[warning]);
for(const field of ['references','unknown']){
 proof={readOnly:true,references:0,unknown:0,warnings:[warning],[field]:1};
 await assert.rejects(check('D:\\Tong\\state\\synthetic\\npm-cache'),error=>{
  assert.match(error.message,/CLEANUP_RUNTIME_REFERENCE_OR_UNKNOWN/);
  assert.equal(error.referenceCheck?.[field],1,'refusal must retain actual counts');
  assert.equal(error.referenceCheck.kind,field==='references'?'live_reference':'unknown');return true;
 });
}
proof={readOnly:true,references:0,unknown:1,unknownKinds:{process_command_line:1,secret:'FAKE_PRIVATE_COMMAND'},unknownProcesses:[{pid:123,name:'node.exe',command:'FAKE_PRIVATE_COMMAND'}]};
await assert.rejects(check('D:\\Tong\\state\\synthetic\\npm-cache'),error=>{
 assert.deepEqual(error.referenceCheck.unknownKinds,{process_command_line:1});
 assert.deepEqual(error.referenceCheck.unknownProcesses,[{pid:123,name:'node.exe'}]);
 assert.ok(!JSON.stringify(error.referenceCheck).includes('FAKE_PRIVATE_COMMAND'));return true;
});
for(const warnings of [[{...warning,code:'OTHER'}],[{...warning,classId:'invalid'}],[{...warning,task:'\\UserTask'}],Array(17).fill(warning)]){
 proof={readOnly:true,references:0,unknown:0,warnings};
 await assert.rejects(check('D:\\Tong\\state\\synthetic\\npm-cache'),/CLEANUP_REFERENCE_CHECK_FAILED/);
}
exit=2;proof={readOnly:true,references:0,unknown:0,warnings:[]};
await assert.rejects(check('D:\\Tong\\state\\synthetic\\npm-cache'),error=>{assert.equal(error.referenceCheck.kind,'child_exit');assert.equal(error.referenceCheck.nativeExitCode,2);return true;});
console.log(JSON.stringify({passed:true,approvedWarningsPreserved:true,knownReferencesRejected:true,unknownRejected:true,malformedWarningsRejected:true,childFailureRejected:true,deletionExecuted:false}));
