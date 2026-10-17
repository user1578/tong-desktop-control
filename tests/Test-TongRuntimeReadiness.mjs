import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {waitForChildReadiness,readinessPolicy} from '../scripts/TongAgentDockRuntime.mjs';

// A deterministic clock exercises real IPC handlers and deadlines without
// spending minutes sleeping or creating another dependency tree.
function fixture(role='devspace',options={}){
  let now=0,next=0;const timers=new Map(),events=[];
  const clock={now:()=>now,setTimeout:(fn,ms)=>{timers.set(++next,{fn,at:now+ms});return next;},clearTimeout:id=>timers.delete(id)};
  const child=new EventEmitter();Object.assign(child,{exitCode:null,signalCode:null});
  const waiting=waitForChildReadiness(child,{role,preserved:true,began:0,startupDeadline:120000,clock,onEvent:e=>events.push(e),...options});
  const settled=waiting.then(()=>({ready:true}),error=>({error}));
  function advance(ms){const end=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;}
  const stage=name=>child.emit('message',{event:'stage',stage:name});
  const beginImport=()=>{advance(14000);stage('settings_received');advance(6000);stage('approval_verified');advance(6500);stage('candidate_verified');advance(1700);stage('config_loaded');stage('log_protection_ready');advance(1100);stage('server_import_begin');};
  return {child,events,settled,advance,stage,beginImport,timers};
}
let t=fixture();t.beginImport();t.advance(19000);t.stage('server_import_complete');t.child.emit('message',{event:'ready'});
assert.equal((await t.settled).ready,true,'progressing cold start above the old 45 second limit succeeds');
assert.equal(t.events.filter(e=>e.event==='readiness_slow').length,1);
assert.ok(t.events.some(e=>e.stage==='server_import_complete'&&e.stageDurationMs===19000));
assert.equal(t.timers.size,0);assert.equal(t.child.listenerCount('message'),0);assert.equal(t.child.listenerCount('exit'),0);
t=fixture();t.stage('settings_received');t.stage('approval_verified');t.stage('candidate_verified');t.stage('config_loaded');t.stage('log_protection_ready');t.stage('server_import_begin');t.advance(1200);t.stage('server_import_complete');t.child.emit('message',{event:'ready'});assert.equal((await t.settled).ready,true);
t=fixture();t.beginImport();t.advance(29999);t.stage('server_import_begin');t.advance(1);
let failure=(await t.settled).error;assert.equal(failure.message,'CHILD_STAGE_TIMEOUT');assert.equal(failure.readiness.stage,'server_import_begin');assert.equal(failure.readiness.stageDurationMs,30000);assert.equal(failure.readiness.timeoutKind,'stage');
t=fixture();t.advance(30000);failure=(await t.settled).error;assert.equal(failure.message,'CHILD_STAGE_TIMEOUT');assert.equal(failure.readiness.stage,'spawned');
t=fixture();t.advance(1000);t.stage('settings_received');t.advance(1000);t.stage('bogus_stage');t.stage('settings_received');t.advance(14000);assert.equal((await t.settled).error.message,'CHILD_STAGE_TIMEOUT');
t=fixture();t.child.emit('exit',7,null);failure=(await t.settled).error;assert.equal(failure.message,'CHILD_EXIT');assert.equal(failure.readiness.exitCode,7);assert.equal(t.timers.size,0);
t=fixture('gateway');t.stage('settings_received');t.stage('approval_verified');t.stage('candidate_verified');t.child.emit('message',{event:'ready'});assert.equal((await t.settled).ready,true);
t=fixture('devspace',{startupDeadline:35000});t.beginImport();t.advance(6000);failure=(await t.settled).error;assert.equal(failure.message,'START_TIMEOUT');assert.equal(failure.readiness.timeoutKind,'startup_total');
t=fixture();t.advance(29000);t.stage('settings_received');t.advance(14000);t.stage('approval_verified');t.advance(19000);t.stage('candidate_verified');t.advance(9000);t.stage('config_loaded');t.stage('log_protection_ready');t.advance(4000);failure=(await t.settled).error;assert.equal(failure.message,'CHILD_READINESS_TIMEOUT');assert.equal(failure.readiness.timeoutKind,'child_total');
t=fixture();t.advance(30000);t.child.emit('message',{event:'ready'});assert.equal((await t.settled).error.message,'CHILD_STAGE_TIMEOUT','late readiness cannot resurrect an expired wait');
t=fixture();t.child.emit('error',new Error('sensitive arbitrary error'));assert.equal((await t.settled).error.message,'CHILD_SPAWN_FAILED');
t=fixture();t.child.emit('message',null);t.child.emit('message',{event:'logging_secret'});t.child.emit('message',{event:'ready'});assert.equal((await t.settled).ready,true,'logging handshake must not settle readiness');
const cancelled=new AbortController();t=fixture('devspace',{signal:cancelled.signal});cancelled.abort();assert.equal((await t.settled).error.message,'START_ABORTED');assert.equal(t.timers.size,0);
t=fixture('devspace',{onEvent:()=>Promise.reject(new Error('diagnostic write failed'))});t.stage('settings_received');assert.equal((await t.settled).error.message,'diagnostic write failed');assert.equal(t.timers.size,0);
assert.equal(readinessPolicy('devspace',true).totalMs,75000);assert.equal(readinessPolicy('gateway',true).totalMs,35000);assert.equal(readinessPolicy('devspace',false).totalMs,20000);
console.log(JSON.stringify({passed:true,normal:true,slowAbove45s:true,stageStall:true,duplicatesDoNotRenew:true,exit:true,spawnFailure:true,childTotal:true,startupTotal:true,lateReadyRejected:true,handlersCleaned:true}));
