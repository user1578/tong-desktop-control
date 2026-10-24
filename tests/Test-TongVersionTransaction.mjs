import assert from 'node:assert/strict';
let api;
try { api=await import('../scripts/TongMaintenanceTransaction.mjs'); } catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }
assert.equal(typeof api?.runMaintenanceTransaction,'function','a persistent source/native/profile/pin transaction is required');
assert.equal(typeof api?.resumeMaintenanceTransaction,'function');
// Production rejection must happen even with an unusable filesystem/profile.
await assert.rejects(api.runMaintenanceTransaction({baselineProfile:{mode:'production'}}),/MAINTENANCE_NOT_READY/);
await assert.rejects(api.resumeMaintenanceTransaction({mode:'production'},{}),/MAINTENANCE_NOT_READY/);
console.log(JSON.stringify({passed:true,productionDeniedBeforeIO:true}));
