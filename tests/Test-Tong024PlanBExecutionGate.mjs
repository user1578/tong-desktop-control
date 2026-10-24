import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describeMaintenance } from '../scripts/Tong024ProductionMaintenance.mjs';

const description = describeMaintenance();
assert.equal(description.executionReadiness, 'NOT READY');
assert.equal(description.executionOrderStatus, 'BLOCKED_NOT_EXECUTABLE');
assert.equal(description.startupHandoff.candidateCommit, description.candidateCommit);
assert.equal(description.startupHandoff.candidateProtocol, 'open-wx/unlink');
assert.equal(description.startupHandoff.supported, false);
assert.ok(description.executionBlockers.includes('EXACT_34E2680_HAS_NO_MAINTENANCE_LEASE_HANDOFF'));

// Test the actual CLI in a fresh process. Even profile reads are trapped, so a
// regression cannot write an incident transaction to the real production root.
const entry = fileURLToPath(new URL('../scripts/Tong024ProductionMaintenance.mjs', import.meta.url));
for (const command of ['run', 'rollback']) {
  const worker = `
    import * as fs from 'node:fs/promises';
    import { registerHooks } from 'node:module';
    const source = Object.keys(fs).filter(key => key !== 'default')
      .map(key => 'export const ' + key + '=()=>{throw Error("PRODUCTION_IO_ATTEMPT")};').join('');
    registerHooks({resolve(specifier, context, next) {
      return specifier === 'node:fs/promises'
        ? {url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}
        : next(specifier, context);
    }});
    process.argv = [process.execPath, ${JSON.stringify(entry)}, ${JSON.stringify(command)}, '--error-json'];
    await import(${JSON.stringify(new URL('../scripts/Tong024ProductionMaintenance.mjs', import.meta.url).href)});
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', worker], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  const failure = JSON.parse(result.stderr.trim());
  assert.equal(failure.error, 'MAINTENANCE_NOT_READY');
  assert.equal(failure.executionReadiness, 'NOT READY');
  assert.ok(failure.executionBlockers.includes('EXACT_34E2680_HAS_NO_MAINTENANCE_LEASE_HANDOFF'));
}
console.log(JSON.stringify({ passed: true, productionIOBlocked: true, cliCommands: ['run', 'rollback'], readiness: 'NOT READY' }));
