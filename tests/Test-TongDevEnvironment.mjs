import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DEV_TOOLS, validateDevEnvironment, inspectDevEnvironment } from '../scripts/TongDevEnvironment.mjs';

assert.deepEqual(validateDevEnvironment({}), {tool:'all'});
assert.deepEqual(validateDevEnvironment({tool:'python'}), {tool:'python'});
assert.equal(DEV_TOOLS.length, 10);
for (const input of [
  null, [], {tool:'cmd'}, {tool:'node --version'}, {tool:'-EncodedCommand'},
  {tool:'all',executable:'powershell.exe'}, {tool:'git',script:'Remove-Item'},
]) assert.throws(() => validateDevEnvironment(input), /Invalid development environment query/);

function mockProbe(payload,{code=0,stderr=''}={}) {
  const calls=[];
  function spawnProcess(exe,args,options) {
    calls.push({exe,args,options});
    const child=new EventEmitter();
    child.stdout=new PassThrough();
    child.stderr=new PassThrough();
    child.kill=()=>true;
    queueMicrotask(()=>{
      if (stderr) child.stderr.write(stderr);
      child.stdout.write(JSON.stringify(payload));
      child.stdout.end(); child.stderr.end();
      child.emit('close',code);
    });
    return child;
  }
  return {calls,spawnProcess};
}
const nodeVersion={source:'process-path',versionSource:'file-metadata',tools:[
  {name:'node',available:true,candidates:[{path:'C:\\Tools\\node.exe',fileVersion:'24.15.0'}],truncated:false},
]};
const probe=mockProbe(nodeVersion);
assert.deepEqual(await inspectDevEnvironment({tool:'node'},{platform:'win32',spawnProcess:probe.spawnProcess}),nodeVersion);
assert.ok(probe.calls[0].exe.endsWith('pwsh.exe'));
assert.deepEqual(probe.calls[0].args.slice(-2),['-Tool','node']);
assert.equal(probe.calls[0].options.shell,false);
assert.equal(probe.calls[0].options.stdio[0],'ignore');
assert.ok(!probe.calls[0].args.includes('-Command'));
assert.ok(!Object.keys(probe.calls[0].options.env).some(key=>/token|secret|password|credential/i.test(key)));

await assert.rejects(inspectDevEnvironment({tool:'node'},{platform:'linux'}),/unavailable/);
await assert.rejects(inspectDevEnvironment({tool:'node'},{platform:'win32',spawnProcess:mockProbe(nodeVersion,{code:1}).spawnProcess}),/inspection failed/);
await assert.rejects(inspectDevEnvironment({tool:'node'},{platform:'win32',spawnProcess:mockProbe(nodeVersion,{stderr:'private text'}).spawnProcess}),/inspection failed/);
for(const bad of [
  {...nodeVersion,tools:[{...nodeVersion.tools[0],candidates:[{...nodeVersion.tools[0].candidates[0],commandLine:'SECRET'}]}]},
  {...nodeVersion,tools:[{...nodeVersion.tools[0],name:'python'}]},
  {...nodeVersion,tools:[{...nodeVersion.tools[0],candidates:[{path:'relative',fileVersion:'1'}]}]},
  {...nodeVersion,tools:[{...nodeVersion.tools[0],candidates:[],available:true}]},
]) {
  await assert.rejects(inspectDevEnvironment({tool:'node'},{platform:'win32',spawnProcess:mockProbe(bad).spawnProcess}),/response invalid/);
}
if(process.platform==='win32'){
  const response=await inspectDevEnvironment({tool:'node'});
  assert.equal(response.tools.length,1);
  assert.equal(response.tools[0].name,'node');
  assert.ok(response.tools[0].candidates.every(c=>Object.keys(c).every(k=>['path','fileVersion'].includes(k))));
  const all=await inspectDevEnvironment({});
  assert.deepEqual(all.tools.map(x=>x.name),DEV_TOOLS);
}
console.log('PASS: fixed PATH developer-tool inventory, Windows file versions, bounded response and input validation.');
