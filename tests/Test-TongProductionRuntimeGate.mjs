import assert from 'node:assert/strict';
import {initializeProductionRuntime,startRuntime,redactedStream} from '../scripts/TongAgentDockRuntime.mjs';
import {once} from 'node:events';
import {createProductionProfile,createProductionSimulationProfile} from '../scripts/TongProductionProfile.mjs';
import {randomBytes} from 'node:crypto';
const profile=createProductionProfile({sourceDigest:'a'.repeat(64),releaseDigest:'b'.repeat(64)});
process.env.TONG_PRODUCTION_APPROVED='1';process.env.TONG_AGENTDOCK_ENABLED='1';
await assert.rejects(startRuntime(profile.root,{approved:true}),/APPROVAL_DENIED/);
await assert.rejects(initializeProductionRuntime(profile,{approved:true}),/APPROVAL_DENIED/);
const sim=createProductionSimulationProfile({simulationId:'b23-unapproved-'+randomBytes(6).toString('hex'),sourceDigest:'a'.repeat(64),releaseDigest:'b'.repeat(64)});
await assert.rejects(initializeProductionRuntime(sim,{approved:true}),/APPROVAL_DENIED/);
// Native owner is sent over private IPC only after configuration loads. Its
// output cannot start until the supervisor acknowledges adding the log secret.
const secrets=[],stream=redactedStream(secrets);let output='';stream.on('data',chunk=>{output+=chunk;});
const owner='SYNTHETIC_LONG_OWNER_'+ 'x'.repeat(512);secrets.push(owner);stream.write('prefix '+owner.slice(0,170));stream.end(owner.slice(170)+' suffix');await once(stream,'end');
assert.equal(output,'prefix [REDACTED] suffix');
console.log('PASS: production runtime rejects absent receipt and env/CLI approval flags before state access.');
