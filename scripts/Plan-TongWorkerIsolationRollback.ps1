param([switch]$Apply)

$ErrorActionPreference = 'Stop'
if ($Apply) { throw 'This script is plan-only. Stage B rollback requires a separate approved rollback operation.' }

$plan = [ordered]@{
    mode = 'PLAN_ONLY'
    applySupported = $false
    approvalRequired = $true
    targetAccount = '.\TongCodexWorker'
    targetService = 'TongWorkerSupervisor'
    steps = @(
        'Stop TongWorkerSupervisor; terminate and confirm every per-task Job Object and descendant process is gone.',
        'Restore every approved project DACL from its local pre-change backup; compare the resulting DACL with the backup before continuing.',
        'Remove the Supervisor service SID ChangePermissions prerequisite from each exact project root and compare with its saved DACL.',
        'Remove Worker SID and task restricting SID ACEs from project/scratch ACLs; remove Worker SID read/execute ACEs from tool directories; verify no task ACE remains.',
        'Delete the TongWorkerSupervisor service registration and verify its SCM service object and HKLM\SYSTEM\CurrentControlSet\Services\TongWorkerSupervisor key are removed (reboot only if SCM marks it for deletion).',
        'If a distinct Gateway service SID was enabled under a separately approved step, restore its exact previous service configuration and identity only after the Worker pipe is disabled.',
        'Remove SeServiceLogonRight and SeIncreaseQuotaPrivilege assignments for the Worker SID; export and compare local security policy before/after.',
        'Run codex logout as TongCodexWorker, then remove C:\Users\TongCodexWorker\.codex and its profile so no Worker auth remains.',
        'After confirming no service or task process is running, remove C:\ProgramData\Tong\Worker and C:\Program Files\Tong Desktop Control Worker.',
        'Delete the local SAM account TongCodexWorker; remove its profile if Windows leaves the profile directory behind.',
        'Confirm DevSpace, Gateway, ngrok, OAuth, ports, firewall, and the main-user Codex profile are unchanged.'
    )
    requiredBackups = @('Local per-project ACL backups outside the project tree', 'Local security-policy export', 'Supervisor service configuration snapshot', 'Gateway service identity/configuration snapshot if separately changed', 'Protected install and state directory ACL snapshots')
    note = 'This output describes rollback only. It does not stop, delete, restore, or change any system object.'
}
$plan | ConvertTo-Json -Depth 6
