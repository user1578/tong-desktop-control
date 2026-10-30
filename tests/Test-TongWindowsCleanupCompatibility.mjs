import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {isAbsolute,resolve,parse} from 'node:path';
import {cleanupContains,validateCleanupGrants} from '../scripts/TongCleanupAuthorization.mjs';

// Check the actual old production schema, not a second handwritten validator.
// No checkout, deployment or production policy is changed.
const result=spawnSync('git',['show','f81d1d0ddcc6da354cb475be628e6b79ca822516:scripts/TongCleanupAuthorization.mjs'],{encoding:'utf8',windowsHide:true});
assert.equal(result.status,0,result.stderr);
const start=result.stdout.indexOf('export function validateCleanupGrants(value){'),end=result.stdout.indexOf('// Deliberately read-only.',start);
assert.ok(start>=0&&end>start);
const oldValidate=new Function('isAbsolute','resolve','parse','cleanupContains','cleanupCategories','fail',result.stdout.slice(start,end).replace('export function','function')+';return validateCleanupGrants;')(isAbsolute,resolve,parse,cleanupContains,['cache','historical-candidate','quick-trust-candidate'],code=>{throw Error(code);});
const oldGrant={id:'tong-state-cleanup',root:'D:\\Tong\\state',enabled:true,revision:'old',scopes:[{relativeRoot:'.',categories:['cache','historical-candidate','quick-trust-candidate']}]};
const windows={id:'tong-windows-cache',root:'C:\\Users\\Synthetic\\AppData\\Local',enabled:true,revision:'new',scopes:['Temp','npm-cache','pip/Cache'].map(relativeRoot=>({relativeRoot,categories:['cache']}))};
const document={schemaVersion:1,grants:[oldGrant,windows]};
assert.deepEqual(validateCleanupGrants(document),document);assert.deepEqual(oldValidate(document),document);
assert.throws(()=>validateCleanupGrants({schemaVersion:1,grants:[{...windows,scopes:[{relativeRoot:'.',categories:['cache']}]}]}),/CLEANUP_AUTHORIZATION_INVALID/);
console.log('PASS: new Windows scopes preserve old v1 policy parsing and original state grant; broad AppData scope refused.');
