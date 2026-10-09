param(
    [string]$ProjectRoot,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
if ($Apply) { throw 'This script is plan-only. Stage B system changes require a separate approved installer.' }
if ($ProjectRoot -and -not [IO.Path]::IsPathRooted($ProjectRoot)) { throw 'ProjectRoot must be an absolute path.' }

$plan = [ordered]@{
    mode = 'PLAN_ONLY'
    applySupported = $false
    approvalRequired = $true
    workerAccount = '.\TongCodexWorker'
    workerAccountType = 'Local standard account; BUILTIN\Users only; not an administrator'
    localRights = @('SeServiceLogonRight', 'SeIncreaseQuotaPrivilege')
    service = [ordered]@{
        name = 'TongWorkerSupervisor'
        executable = 'C:\Program Files\Tong Desktop Control Worker\TongWorkerSupervisor.exe'
        logonAccount = '.\TongCodexWorker'
        startType = 'Automatic (Delayed Start)'
        serviceSidType = 'SERVICE_SID_TYPE_UNRESTRICTED'
        failureActions = 'None; startup failure leaves real execution disabled'
        pipe = '\\.\pipe\TongWorkerSupervisor'
    }
    paths = @(
        @{ path = 'C:\Program Files\Tong Desktop Control Worker'; systemAndAdministrators = 'FullControl'; worker = 'ReadAndExecute' },
        @{ path = 'C:\ProgramData\Tong\Worker'; systemAndAdministrators = 'FullControl'; worker = 'Modify' },
        @{ path = 'C:\Users\TongCodexWorker\.codex'; system = 'FullControl'; worker = 'Modify'; gatewayAndOtherUsers = 'No access ACE' },
        @{ path = 'C:\Users\TongCodexWorker\AppData\Local\Tong\Worker\Tasks\<taskId>'; system = 'FullControl'; workerAndTaskRestrictingSid = 'Modify' },
        @{ path = 'D:\node'; workerAndWorkerRestrictingSid = 'ReadAndExecute'; gateway = 'No new access' },
        @{ path = 'C:\Program Files\Git'; workerAndWorkerRestrictingSid = 'ReadAndExecute'; gateway = 'No new access' },
        @{ path = 'C:\Program Files\Python311'; workerAndWorkerRestrictingSid = 'ReadAndExecute'; gateway = 'No new access' }
    )
    projectAclTarget = if ($ProjectRoot) { $ProjectRoot } else { '<one exact agent.execute-authorized project root, supplied at Stage B>' }
    projectAcl = 'Back up its current DACL locally; add Worker SID + unique task restricting SID Modify ACE only while that task owns a Job Object; remove and compare after exit. Never recurse from D:\ or a shared parent.'
    pipeAcl = 'SYSTEM, Administrators, Gateway SID, and Worker service SID only; verify connecting client PID token SID.'
    processBoundary = 'Restricted token; Authenticated Users deny-only; fixed executable and clean environment; per-task Job Object with KILL_ON_JOB_CLOSE; private inherited stdio.'
    auth = 'Independent codex login --device-auth under TongCodexWorker; never copy the main user profile or token.'
    network = 'No firewall change. Codex inference requires outbound network; exfiltration remains possible.'
    unchanged = @('DevSpace/Gateway/ngrok processes and ports', 'OAuth configuration', 'system PATH/environment', 'firewall', 'other project ACLs')
    note = 'This output is a review plan, not an installer. No system object was changed.'
}
$plan | ConvertTo-Json -Depth 8
