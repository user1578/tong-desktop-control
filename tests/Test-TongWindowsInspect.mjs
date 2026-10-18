import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { inspectWindows, validateWindowsInspect } from '../scripts/TongWindowsInspect.mjs';

assert.deepEqual(validateWindowsInspect({kind:'processes'}), {kind:'processes',name:'',limit:30});
for(const input of [
  {}, {kind:'files'}, {kind:'services',name:'*'},
  {kind:'processes',name:'node;Remove-Item'},
  {kind:'processes',name:'-EncodedCommand'},
  {kind:'services',limit:101}, {kind:'services',limit:0},
  {kind:'services',program:'powershell'},
]) {
  assert.throws(() => validateWindowsInspect(input), /Invalid Windows inspection request/);
}
const makeSpawn = (response, {error=false} = {}) => {
  const calls=[];
  function spawnProcess(exe,args,options) {
    calls.push({exe,args,options});
    const child=new EventEmitter();
    child.stdout=new PassThrough();
    child.stderr=new PassThrough();
    child.kill=()=>true;
    queueMicrotask(()=>{
      if(error){
        child.stderr.write('PRIVATE_ERROR_STRING');
        child.stderr.end();
        child.stdout.end();
        child.emit('close',1);
      }else{
        child.stdout.write(JSON.stringify(response));
        child.stdout.end();
        child.stderr.end();
        child.emit('close',0);
      }
    });
    return child;
  }
  return {spawnProcess,calls};
};
const payload={kind:'processes',entries:[{pid:123,name:'node',workingSetBytes:1024}],count:1,truncated:false};
const sim=makeSpawn(payload);
const result=await inspectWindows({kind:'processes',name:'node',limit:4},
  {platform:'win32',spawnProcess:sim.spawnProcess});
assert.deepEqual(result,payload);
assert.equal(sim.calls.length,1);
assert.ok(sim.calls[0].exe.endsWith('pwsh.exe'));
assert.deepEqual(sim.calls[0].args.slice(-6),['-Kind','processes','-Limit','4','-Name','node']);
assert.equal(sim.calls[0].options.shell,false);
assert.equal(sim.calls[0].options.stdio[0],'ignore');
assert.ok(!Object.keys(sim.calls[0].options.env).some(k=>/token|secret|key/i.test(k)));
assert.ok(!sim.calls[0].args.includes('-Command'));

await assert.rejects(inspectWindows({kind:'processes'}, {platform:'linux'}), /unavailable/);
await assert.rejects(inspectWindows({kind:'processes'},
 {platform:'win32',spawnProcess:makeSpawn(payload,{error:true}).spawnProcess}), /Windows inspection failed/);

const malformed=makeSpawn({kind:'processes',entries:[{pid:1,name:'test',workingSetBytes:1,commandLine:'secret'}],count:1,truncated:false});
await assert.rejects(inspectWindows({kind:'processes'}, {platform:'win32',spawnProcess:malformed.spawnProcess}),
 /response invalid/);

if(process.platform==='win32'){
  const real=await inspectWindows({kind:'services',name:'EventLog',limit:2});
  assert.equal(real.kind,'services');
  assert.ok(real.entries.every(x=>Object.keys(x).every(k=>['name','displayName','status'].includes(k))));
}
console.log('PASS: Windows inspection validated, bounded, no arbitrary shell or command-line disclosure.');
