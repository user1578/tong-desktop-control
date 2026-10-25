import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer,createConnection} from 'node:net';
import {assertPortUnused} from '../scripts/TongRuntimePort.mjs';
const source=await readFile(new URL('../scripts/TongAgentDockRuntime.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function unused(port)'),end=source.indexOf('\nexport async function ',start);
assert.ok(start>0&&end>start);
// Execute the exact private function with real Node sockets, without exporting
// a product-only test API or replacing any native result.
const unused=Function('createServer','createConnection','fail','assertPortUnused',source.slice(start,end)+';return unused;')(createServer,createConnection,code=>Error(code),assertPortUnused);
let contacts=0;const occupied=createServer(s=>{contacts++;s.destroy();});
await new Promise(ok=>occupied.listen(0,'127.0.0.1',ok));const port=occupied.address().port;
try{await assert.rejects(unused(port),/PORT_OCCUPIED|PORT_CHECK_FAILED/);await new Promise(ok=>setTimeout(ok,50));assert.equal(contacts,0,'port observation must not connect to the occupying service');}finally{await new Promise(ok=>occupied.close(ok));}
const began=performance.now();const proof=await assertPortUnused(port);const elapsedMs=Math.round(performance.now()-began);assert.equal(proof.free,true);assert.ok(proof.bindMs<1000);
const wildcard=createServer();await new Promise(ok=>wildcard.listen(0,'0.0.0.0',ok));try{await assert.rejects(unused(wildcard.address().port),/PORT_OCCUPIED|PORT_CHECK_FAILED/);}finally{await new Promise(ok=>wildcard.close(ok));}
console.log(JSON.stringify({passed:true,realOccupiedPortDenied:true,noServiceContact:true,wildcardOccupiedDenied:true,freeProbeTotalMs:elapsedMs,freeExclusiveBindMs:proof.bindMs}));
