import assert from 'node:assert/strict';
import {diagnoseRecoveryFailure} from '../scripts/TongLoginRecovery.mjs';
import {diagnoseMonitorFailure} from '../scripts/TongAgentDockRuntime.mjs';

assert.deepEqual(diagnoseRecoveryFailure('envelope_unseal', Object.assign(new Error('secret-should-not-leak'), {code:'ETIMEDOUT'})),{stage:'envelope_unseal',kind:'ETIMEDOUT'});
assert.deepEqual(diagnoseRecoveryFailure('audit_load', new SyntaxError('full secret error text')),{stage:'audit_load',kind:'PARSE_ERROR'});
assert.deepEqual(diagnoseRecoveryFailure('some secret and path', Object.assign(new Error('secret'),{code:'CREDENTIALS-123'})),{stage:'unspecified',kind:'UNKNOWN'});
assert.deepEqual(diagnoseRecoveryFailure('audit_validate', new Error('APPROVAL_DENIED')),{stage:'audit_validate',kind:'AUTH_REJECTED'});
assert.deepEqual(diagnoseRecoveryFailure('handler', Object.assign(new Error('untrusted'),{code:'EPERM'})),{stage:'handler',kind:'EPERM'});
assert.deepEqual(diagnoseMonitorFailure('descendant_capture', Object.assign(new Error('private path should not leak'),{code:'EPERM'})),{stage:'descendant_capture',kind:'EPERM'});
assert.deepEqual(diagnoseMonitorFailure('stop_read', Object.assign(new Error('redact me'),{code:'ENOENT'})),{stage:'stop_read',kind:'ENOENT'});
assert.deepEqual(diagnoseMonitorFailure('requested_shutdown', new Error('hidden')), {stage:'requested_shutdown',kind:'UNKNOWN'});
assert.deepEqual(diagnoseMonitorFailure('path with token', Object.assign(new Error('redact'),{code:'custom_secret'})),{stage:'unspecified',kind:'UNKNOWN'});
console.log('safe runtime diagnostic labels: passed');
