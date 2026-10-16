// Restored snapshots retain evidence, never runnable project permissions.
export function revokeRestoredTrustedAuthorization(value) {
  value.enabled=false;
  value.projects=[];
  value.approvals=[];
  value.developmentGrants=[];
  value.generation=(value.generation??0)+1;
  return value;
}
