import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=await mkdtemp('D:\\Tong\\state\\receipt-atomic-'),target=join(root,'state.json'),worker=join(root,'writer.ps1');
const protocol=fileURLToPath(new URL('../scripts/TongStartupProtocol.ps1',import.meta.url));
const boundaries=join(root,'boundaries.ps1');
await writeFile(boundaries,`. '${protocol.replaceAll("'","''")}'
$ErrorActionPreference='Stop'
$target='${target}';$temp=$target+'.pending'
[IO.File]::WriteAllText($target,'{"old":true}');[IO.File]::WriteAllText($temp,'{"new":true}')
$old=[IO.File]::Open($target,'Open','Read',([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
try{
 [TongStartupPreflight]::AtomicReplace($temp,$target)
 $reader=[IO.StreamReader]::new($old);if($reader.ReadToEnd() -cne '{"old":true}'){throw 'Old handle changed'}
 if([IO.File]::ReadAllText($target) -cne '{"new":true}'){throw 'New open did not see replacement'}
}finally{$old.Dispose()}
# An abandoned publication leaves the old committed bytes and pending bytes.
[IO.File]::WriteAllText($temp,'{"pending":true}')
if([IO.File]::ReadAllText($target) -cne '{"new":true}'){throw 'Unpublished bytes escaped'}
[IO.File]::SetAttributes($target,[IO.FileAttributes]::ReadOnly)
try{
 $refused=$false;try{[TongStartupPreflight]::AtomicReplace($temp,$target)}catch{$refused=$true}
 if(-not $refused -or [IO.File]::ReadAllText($target) -cne '{"new":true}' -or [IO.File]::ReadAllText($temp) -cne '{"pending":true}'){throw 'Refused replacement lost bytes'}
}finally{[IO.File]::SetAttributes($target,[IO.FileAttributes]::Normal)}
# Source ownership conflict is a hard failure with both files preserved.
$owned=[IO.File]::Open($temp,'Open','Read',[IO.FileShare]::Read)
try{$refused=$false;try{[TongStartupPreflight]::AtomicReplace($temp,$target)}catch{$refused=$true};if(-not $refused){throw 'Source conflict ignored'}}finally{$owned.Dispose()}
if([IO.File]::ReadAllText($target) -cne '{"new":true}' -or [IO.File]::ReadAllText($temp) -cne '{"pending":true}'){throw 'Failed publication lost bytes'}
[TongStartupPreflight]::AtomicReplace($temp,$target)
if([IO.File]::ReadAllText($target) -cne '{"pending":true}'){throw 'Explicit recovery failed'}
Write-Output 'PASS: held reader, old/new identity, abandoned publication, readonly refusal, source conflict, explicit recovery'
`);
const shell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const boundary=spawnSync(shell,['-NoProfile','-NonInteractive','-File',boundaries],{windowsHide:true,encoding:'utf8',timeout:10000});
assert.equal(boundary.status,0,boundary.stderr);console.log(boundary.stdout.trim());
await writeFile(target,'{}');
await writeFile(worker,`. '${protocol.replaceAll("'","''")}'
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$path='${target}'
for($n=0;$n -lt 400;$n++){
 $temp=$path+'.tmp';[IO.File]::WriteAllText($temp,('{"seq":'+$n+',"value":"'+('x'*5000)+'"}'),[Text.UTF8Encoding]::new($false))
 try{[TongStartupPreflight]::AtomicReplace($temp,$path)}catch{$exception=$_.Exception;while($exception.InnerException){$exception=$exception.InnerException};[Console]::Error.WriteLine(('NATIVE_ERROR='+$exception.NativeErrorCode));exit 1}
}
`);
const child=spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-File',worker],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let done=false,stderr='',reads=0,errors=[];
const closed=new Promise(resolve=>{child.once('error',error=>{done=true;resolve({error:error.code});});child.once('close',code=>{done=true;resolve({code});});});
child.stdout.resume();child.stderr.on('data',chunk=>stderr+=chunk);
const timeout=setTimeout(()=>child.kill(),10000);
try{
 // A valid shared reader must never make publication depend on a timing gap.
 while(!done){try{JSON.parse(await readFile(target,'utf8'));reads++;}catch(error){errors.push(error.code??'JSON_PARSE_FAILED');}await new Promise(ok=>setTimeout(ok,1));}
 const result=await closed;assert.equal(result.code,0,stderr);assert.ok(reads>0);assert.deepEqual(errors,[]);
}finally{clearTimeout(timeout);if(!done)child.kill();}
console.log(JSON.stringify({passed:true,root,reads,errors:0,atomicReplacement:true,heldReader:true,deniedAndInterruptedIntegrity:true}));
