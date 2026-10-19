import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {win32} from 'node:path';

// Development-only cryptographic boundary for DSH MOCK tasks. This module
// cannot execute a provider, mint real Tong grants, or authorize a model call.
const PURPOSE='tong-dsh-s1b1-mock-task-v1';
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG=/^[a-z][a-z0-9_-]{1,63}$/;
const HEX=/^[0-9a-f]{64}$/i;
const OWN=['purpose','nonce','issuedAt','expiresAt','scopeDigest','signature'];

const fail=()=>{throw new Error('DSH S1B1 synthetic grant denied');};
function shapeExact(obj,keys){
  if(!obj||typeof obj!=='object'||Array.isArray(obj))fail();
  const got=Object.keys(obj).sort();
  if(got.length!==keys.length||got.some((key,i)=>key!==[...keys].sort()[i]))fail();
}
function digestRequest(spec){
  shapeExact(spec,['projectId','taskId','projectRoot','scope','prompt',
    'sessionMode','sessionId','timeoutMs']);
  if(!SLUG.test(spec.projectId)||!SLUG.test(spec.taskId)||
     !/^[A-Za-z]:\\/.test(spec.projectRoot)||spec.projectRoot.length>512||
     spec.projectRoot.split(/[\\/]/).some(p=>p==='..')||
     !['new','existing'].includes(spec.sessionMode)||
     (spec.sessionMode==='existing'?!GUID.test(spec.sessionId??''):
       spec.sessionId!==null) ||
     typeof spec.prompt!=='string'||!spec.prompt.trim()||spec.prompt.length>16000||
     typeof spec.scope!=='string'||!spec.scope.trim()||spec.scope.length>1000||
     !Number.isInteger(spec.timeoutMs)||spec.timeoutMs<1000||spec.timeoutMs>120000)
     fail();
  return createHash('sha256').update(JSON.stringify([
    'dsh','synthetic-only',spec.projectId,spec.taskId,
    win32.normalize(spec.projectRoot).toLowerCase(),
    spec.scope,spec.prompt,spec.sessionMode,spec.sessionId,spec.timeoutMs,
  ])).digest('hex');
}
function key(secret) {
  if(!Buffer.isBuffer(secret)||secret.length<32||secret.length>128)fail();
  return secret;
}
function signedFields(v) {
  return JSON.stringify([v.purpose,v.nonce,v.issuedAt,v.expiresAt,v.scopeDigest]);
}
function mac(v,secret){return createHmac('sha256',key(secret)).update(signedFields(v)).digest('hex');}

export function issueDshS1B1SyntheticGrant(spec,{secret,now=Date.now(),nonce=randomUUID()}={}){
  const scopeDigest=digestRequest(spec);
  if(!Number.isSafeInteger(now)||!GUID.test(nonce))fail();
  const grant={
    purpose:PURPOSE,nonce,issuedAt:now,expiresAt:now+60000,scopeDigest,
  };
  return Object.freeze({...grant,signature:mac(grant,secret)});
}
export function verifyDshS1B1SyntheticGrant(spec,grant,{
  secret,now=Date.now(),consumedNonces,
}={}){
  const digest=digestRequest(spec);
  shapeExact(grant,OWN);
  if(grant.purpose!==PURPOSE||!GUID.test(grant.nonce)||
     !HEX.test(grant.scopeDigest)||!HEX.test(grant.signature)||
     !Number.isSafeInteger(grant.issuedAt)||
     !Number.isSafeInteger(grant.expiresAt)||
     !Number.isSafeInteger(now)||grant.issuedAt>now||
     grant.expiresAt<=now||grant.expiresAt-grant.issuedAt>60000||
     grant.scopeDigest!==digest||
     !(consumedNonces instanceof Set)||consumedNonces.has(grant.nonce))fail();
  const expected=Buffer.from(mac(grant,secret),'hex');
  const actual=Buffer.from(grant.signature,'hex');
  if(!timingSafeEqual(expected,actual))fail();
  consumedNonces.add(grant.nonce);
  return Object.freeze({
    permitted:true,syntheticOnly:true,projectId:spec.projectId,
    taskId:spec.taskId,scopeDigest:grant.scopeDigest,nonce:grant.nonce,
    mayStartDsh:false,mayCallModel:false,
  });
}
