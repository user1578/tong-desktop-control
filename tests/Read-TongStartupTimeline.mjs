// Read-only reconstruction from the original, stopped production incident.
// Output is timing/hash metadata; never credentials, command lines or log text.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const window='D:\\Tong\\state\\b23-login-68009b23f4794f16a6a9e03b1510f65a\\offline-9850e1a\\production-comm-402b8fd5-d82d-47eb-a0eb-8987b769f0a0';
const logs='D:\\Tong\\runtime\\logs',run=join(window,'failed-attempt/run');
const ids=['97158a7a-a328-454c-a443-c14da799c0b9','e5b69347-6b26-46e6-bef1-61aadf865163','a5108ab9-f57c-4673-950a-087f09f8cca8'];
const sources=[];
async function source(path){try{const bytes=await readFile(path);sources.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});return bytes.toString('utf8');}catch(e){if(e.code!=='ENOENT')throw e;sources.push({path,absent:true});return '';}}
const rows=async path=>(await source(path)).split(/\r?\n/).filter(Boolean).map(JSON.parse);
const life=await rows(join(logs,'lifecycle.jsonl')),guardianLog=await rows(join(logs,'guardian.jsonl')),manager=await rows(join(logs,'login-management.jsonl')),supervisor=await rows(join(logs,'supervisor.jsonl'));
for(const name of ['host.stdout.log','host.stderr.log','host.failure.log'])await source(join('D:\\Tong\\runtime\\login-management',name));
await source(join(logs,'login-management.log'));
for(const name of ['production.operation.failure.json','new-runs.stopped.admin.json','maintenance.closed.failure.json','rollback.final-files.verified.json','formal-task.started.json'])await source(join(window,name));
const latestRequest=JSON.parse(await source(join(run,'request.json')));await source(join(run,'runtime.json'));await source(join(run,'guardian.json'));await source(join(run,'abort.json'));
const epoch=ticks=>Number((BigInt(ticks)-621355968000000000n)/10000n);
const iso=ms=>new Date(ms).toISOString();
const results=[];
for(const id of ids){
 const launcher=JSON.parse(await source(join(run,`launcher.${id}.json`))),guardian=JSON.parse(await source(join(run,`guardian.${id}.json`)));
 const events=life.filter(e=>e.runId===id),g=guardianLog.filter(e=>e.runId===id),total=events.find(e=>e.event==='startup_failure'&&e.timeoutKind==='startup_total'&&e.budgetMs);
 const requestAt=id===latestRequest.runId?Date.parse(latestRequest.createdAt):Date.parse(total.at)-total.durationMs;
 const timeline=[];const add=(phase,start,end,extra={})=>timeline.push({phase,startAt:iso(start),endAt:iso(end),wallMs:end-start,cpuMs:null,waitingMs:null,...extra});
 const result=events.find(e=>e.event==='startup_result'),checkpoints=life.filter(e=>e.diagnosticId===result.diagnosticId&&e.event==='startup_checkpoint');
 for(let n=0;n<checkpoints.length-1;n++)add('manager_'+checkpoints[n].stage,Date.parse(checkpoints[n].at),Date.parse(checkpoints[n+1].at));
 add('request_to_launcher',requestAt,epoch(launcher.launcher.startTicks));
 add('launcher_initialization',epoch(launcher.launcher.startTicks),Date.parse(launcher.preflight.startedAt));
 add('launcher_preflight',Date.parse(launcher.preflight.startedAt),Date.parse(launcher.preflight.startedAt)+launcher.preflight.elapsedMs);
 add('launcher_to_guardian_creation',Date.parse(launcher.preflight.startedAt)+launcher.preflight.elapsedMs,epoch(launcher.guardian.startTicks));
 add('guardian_initialization_and_first_preflight',epoch(launcher.guardian.startTicks),Date.parse(g.find(e=>e.event==='guardian_started').at),{splitUnknown:true,reason:'first preflight has no separate timing receipt'});
 add('guardian_compile_request_validation',Date.parse(g.find(e=>e.event==='guardian_started').at),Date.parse(guardian.preflight.startedAt));
 add('guardian_second_preflight',Date.parse(guardian.preflight.startedAt),Date.parse(guardian.preflight.startedAt)+guardian.preflight.elapsedMs);
 add('guardian_job_and_node_creation',Date.parse(guardian.preflight.startedAt)+guardian.preflight.elapsedMs,Date.parse(g.find(e=>e.event==='node_spawned').at));
 add('node_to_job_receipt',Date.parse(g.find(e=>e.event==='node_spawned').at),Date.parse(g.find(e=>e.event==='job_assigned').at));
 add('supervisor_bootstrap_security_and_state',epoch(guardian.node.startTicks),Date.parse(events.find(e=>e.event==='start').at),{overlaps:'node_to_job_receipt'});
 add('agentdock_creation_and_authenticated_health',Date.parse(events.find(e=>e.event==='start').at),Date.parse(events.find(e=>e.event==='readiness_begin').at));
 for(const role of ['devspace','gateway']){
  const begin=events.find(e=>e.event==='readiness_begin'&&e.role===role);if(!begin)continue;
  const stages=events.filter(e=>e.event==='child_stage'&&e.role===role);let stage='spawned',at=Date.parse(begin.at);
  for(const e of stages){add(role+'_'+stage,at,Date.parse(e.at),e.importDurationMs===undefined?{}:{importWallMs:e.importDurationMs,cpuUserMs:e.importCpuUserMs,cpuSystemMs:e.importCpuSystemMs,nonCpuRemainderMs:e.importDurationMs-e.importCpuUserMs-e.importCpuSystemMs,waitingMs:null});stage=e.stage;at=Date.parse(e.at);}
  const end=events.find(e=>e.event==='readiness_complete'&&e.role===role)??events.find(e=>e.event==='startup_failure'&&e.role===role&&!e.budgetMs);
  if(end)add(role+'_'+stage,at,Date.parse(end.at),{terminal:end.event,includesOAuthAndListen:role==='devspace'&&stage==='server_import_complete'});
 }
 const streamMetadata=[];
 for(const role of ['agentdock','devspace','gateway'])for(const stream of ['stdout','stderr']){
  const path=join(logs,`${id}-${role}.${stream}.log`),text=await source(path),entries=text.split(/\r?\n/).filter(Boolean),parsed=[];let partial=0;
  for(const line of entries){try{parsed.push(JSON.parse(line));}catch{partial++;}}
  streamMetadata.push({role,stream,bytes:Buffer.byteLength(text),completeJsonRecords:parsed.length,nonJsonOrPartialRecords:partial,...(role==='agentdock'?{events:parsed.filter(e=>e.stage||e.msg==='http request').map(e=>({at:e.time,event:e.stage??'http_request',durationMs:e.duration_ms,status:e.status}))}:{})});
 }
 results.push({runId:id,requestAt:iso(requestAt),requestTimestampEvidence:id===latestRequest.runId?'original request.json':'derived from Manager failure.at minus durationMs; earlier request overwritten',deadline:iso(requestAt+120000),totalWallMs:total.durationMs,ready:false,supervisorLogRecords:supervisor.filter(e=>e.runId===id).length,managerEvents:manager.filter(e=>e.at>=iso(requestAt-35000)&&e.at<=result.at).map(({at,event,reason})=>({at,event,reason})),timeline,streamMetadata,cleanup:{manager:result.cleanup,guardianRuntimeClean:guardian.runtimeClean,guardianJobActiveAfterCleanup:guardian.jobActiveAfterCleanup,supervisorExit:guardian.nodeExitCode}});
}
console.log(JSON.stringify({readOnly:true,window,sources,results,limits:['CPU and exact waiting time unknown except reported DevSpace import CPU','wall minus CPU is unclassified time, not proof of disk/Defender/OAuth wait','Guardian first preflight is combined with initialization; no per-call timestamp','OAuth initialization only bounded by server_import_complete to readiness_complete','No Gateway settings receipt before global timeout','No Supervisor-specific fatal/exit log records for these three runs']},null,2));
