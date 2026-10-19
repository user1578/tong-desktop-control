import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {issueDshS1B1SyntheticGrant,verifyDshS1B1SyntheticGrant}
    from '../scripts/TongDshS1B1SyntheticGrant.mjs';

const secret=Buffer.alloc(32,17);
const other=Buffer.alloc(32,18);
const now=1800000000000;
const nonce='11111111-2222-4333-8444-555555555555';
const request={
  projectId:'p3-mock',taskId:'task-s1',
  projectRoot:'D:\\Tong\\MockProject',
  scope:'only literal mock SDK events',
  prompt:'SYNTHETIC_TEST_ONLY',
  sessionMode:'new',sessionId:null,timeoutMs:5000,
};
const mk=(spec=request,opts={})=>issueDshS1B1SyntheticGrant(
  spec,{secret,now,nonce,...opts});
const check=(spec,grant,opts={})=>verifyDshS1B1SyntheticGrant(
  spec,grant,{secret,now:now+1,consumedNonces:new Set(),...opts});

const grant=mk();
assert.ok(Object.isFrozen(grant));
assert.equal(grant.purpose,'tong-dsh-s1b1-mock-task-v1');
assert.equal(grant.issuedAt,now);
assert.equal(grant.expiresAt,now+60000);
assert.equal(grant.scopeDigest.length,64);
assert.equal(grant.signature.length,64);
const permitted=check(request,grant);
assert.deepEqual({
  permitted:permitted.permitted,
  syntheticOnly:permitted.syntheticOnly,
  mayStartDsh:permitted.mayStartDsh,
  mayCallModel:permitted.mayCallModel,
},{permitted:true,syntheticOnly:true,mayStartDsh:false,mayCallModel:false});
assert.ok(!JSON.stringify(grant).includes(secret.toString('hex')));
assert.ok(!JSON.stringify(permitted).includes('SYNTHETIC_TEST_ONLY'));

const used=new Set();
check(request,grant,{consumedNonces:used});
assert.equal(used.has(nonce),true);
assert.throws(()=>check(request,grant,{consumedNonces:used}),/denied/);
for(const bad of [
  {...request,projectId:'other-p3'},
  {...request,taskId:'another-task'},
  {...request,projectRoot:'D:\\Tong\\AnotherProject'},
  {...request,scope:'read private file'},
  {...request,prompt:'execute tool'},
  {...request,timeoutMs:5001},
  {...request,sessionMode:'existing',sessionId:'22222222-3333-4444-8555-666666666666'},
])assert.throws(()=>check(bad,grant),/denied/);
for(const bad of [
  {...grant,scopeDigest:'0'.repeat(64)},
  {...grant,signature:'0'.repeat(64)},
  {...grant,expiresAt:grant.expiresAt+100000},
  {...grant,issuedAt:now+100},
  {...grant,purpose:'tong-production-provider'},
  {...grant,unknown:'forged'},
])assert.throws(()=>check(request,bad),/denied/);
assert.throws(()=>check(request,grant,{secret:other}),/denied/);
assert.throws(()=>check(request,grant,{now:now+60000}),/denied/);
assert.throws(()=>check(request,grant,{now:now-1}),/denied/);
assert.throws(()=>check(request,grant,{consumedNonces:null}),/denied/);
for(const bad of [
  {...request,projectRoot:'D:\\Tong\\..\\Other'},
  {...request,projectRoot:'\\\\host\\share'},
  {...request,projectId:'../../prod'},
  {...request,sessionId:'abc'},
  {...request,timeoutMs:999},
  {...request,unreviewed:true},
])assert.throws(()=>mk(bad),/denied/);
assert.throws(()=>mk(request,{secret:Buffer.from('tiny')}),/denied/);
const resumed={...request,sessionMode:'existing',
 sessionId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'};
const resumedGrant=mk(resumed,{nonce:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'});
assert.equal(check(resumed,resumedGrant).permitted,true);
assert.throws(()=>check({...resumed,sessionId:'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'},
 resumedGrant),/denied/);
console.log('PASS DSH S1B1: HMAC-bound mock task grants, project/session/scope/expiry/replay, no live execution.');
