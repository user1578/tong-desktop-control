import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const patch=(await readFile(new URL('../scripts/Apply-TongDevSpacePatch.mjs',import.meta.url),'utf8')).replaceAll('\r\n','\n');
const start=patch.indexOf('function replaceOnce('),end=patch.indexOf('\nconst files = [',start);
const transform=new Function('source',patch.slice(start,end)+'\nreturn extendRestrictedServer(source);');
// Read only the installed source as the real baseline. Never patch App in place.
const current=await readFile('D:\\Tong\\app\\node_modules\\@waishnav\\devspace\\dist\\server.js','utf8');
const next=transform(current);
const guardStart=next.indexOf('const TONG_ALLOWED_TOOLS = new Set('),guardEnd=next.indexOf('const MCP_SESSION_IDLE_TIMEOUT_MS',guardStart);
assert.ok(guardStart>=0&&guardEnd>guardStart);
const registered=[];
const register=new Function('process','registerBaseAppTool',next.slice(guardStart,guardEnd)+'\nreturn registerAppTool;')({env:{TONG_RESTRICTED_MCP:'1'}},(_,name)=>registered.push(name));
for(const name of ['open_workspace','tong_disk_cleanup_plan','tong_disk_cleanup_execute','tong_disk_cleanup_run','tong_disk_cleanup_job','exec_command'])register({},name,{},()=>{});
assert.deepEqual(registered,['open_workspace','tong_disk_cleanup_plan','tong_disk_cleanup_execute','tong_disk_cleanup_run','tong_disk_cleanup_job']);
assert.equal(transform(next),next,'Applying the patch again must be idempotent');
const expected=patch.match(/name:\s*"server.js"[\s\S]*?patchedHash:\s*"([a-f0-9]{64})"/)[1];
assert.equal(createHash('sha256').update(next).digest('hex'),expected,'The archived server patch must bind the actual transformed bytes');
console.log(JSON.stringify({passed:true,cleanupToolsRegistered:true,unlistedCommandDenied:true,idempotent:true,patchHashBound:true,productionModified:false}));
