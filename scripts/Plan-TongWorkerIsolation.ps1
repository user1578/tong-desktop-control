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
    gatewayIdentity = 'Proposed dedicated virtual account NT SERVICE\TongGateway for a separately approved Gateway Windows service; current interactive Gateway identity is insufficient. No change is made by this plan.'
    gatewayServiceSid = 'S-1-5-80-530400873-148631718-326668357-2542268216-906724901 (NT SERVICE\TongGateway; currently inactive)'
    gatewayAccountSid = 'S-1-5-80-530400873-148631718-326668357-2542268216-906724901 (proposed NT SERVICE\TongGateway virtual account; must be verified after service installation)'
    supervisorServiceSid = 'S-1-5-80-2293798348-822329532-632115720-2296630101-786797740 (NT SERVICE\TongWorkerSupervisor; currently inactive)'
    service = [ordered]@{
        name = 'TongWorkerSupervisor'
        executable = 'C:\Program Files\Tong Desktop Control Worker\TongWorkerSupervisor.exe'
        policy = 'C:\Program Files\Tong Desktop Control Worker\worker-policy.json'
        imagePath = '"C:\Program Files\Tong Desktop Control Worker\TongWorkerSupervisor.exe" --service "C:\Program Files\Tong Desktop Control Worker\worker-policy.json"'
        logonAccount = '.\TongCodexWorker'
        startType = 'Manual (demand start); never Automatic on first installation'
        serviceSidType = 'SERVICE_SID_TYPE_UNRESTRICTED'
        failureActions = 'None; startup failure leaves real execution disabled'
        pipe = '\\.\pipe\TongWorkerSupervisor'
    }
    paths = @(
        @{ path = 'C:\Program Files\Tong Desktop Control Worker'; owner = 'SYSTEM or Administrators'; systemAndAdministrators = 'FullControl'; workerAndGateway = 'ReadAndExecute only'; contents = 'Supervisor EXE, Node EXE, Codex EXE, fixed Worker JS modules and protected policy JSON; all SHA-256 pinned' },
        @{ path = 'C:\ProgramData\Tong\Worker'; owner = 'SYSTEM or Administrators'; systemAndAdministrators = 'FullControl'; supervisorServiceSid = 'Modify'; workerAndGatewayAndBroadUsers = 'No access ACE'; ownerRights = 'Deny ChangePermissions on descendants' },
        @{ path = 'C:\Users\TongCodexWorker\.codex'; system = 'FullControl'; worker = 'Modify'; gatewayAndOtherUsers = 'No access ACE' },
        @{ path = 'C:\Users\TongCodexWorker\AppData\Local\Tong\Worker\Tasks\<taskId>'; system = 'FullControl'; workerAndTaskRestrictingSid = 'Modify' },
        @{ path = 'D:\node'; workerAndWorkerRestrictingSid = 'ReadAndExecute'; gateway = 'No new access' },
        @{ path = 'C:\Program Files\Git'; workerAndWorkerRestrictingSid = 'ReadAndExecute'; gateway = 'No new access' },
        @{ path = 'C:\Program Files\Python311'; workerAndWorkerRestrictingSid = 'ReadAndExecute'; gateway = 'No new access' }
    )
    projectAclTarget = if ($ProjectRoot) { $ProjectRoot } else { '<one exact agent.execute-authorized project root, supplied at Stage B>' }
    projectAcl = 'Approve one exact root and grant Supervisor service SID ChangePermissions on that root only; journal original DACL and file identity locally; add Worker SID + unique task restricting SID Modify ACE only during its Job; compare-and-restore after exit or startup recovery; conflict stops execution. Never recurse from D:\ or a shared parent.'
    pipeAcl = 'SYSTEM, Administrators, distinct Gateway service SID, and Supervisor service SID only; native server verifies client service SID, primary account SID, PID, exact image path and SHA-256; native bridge verifies server PID, primary SID, image path and SHA-256.'
    processBoundary = 'Restricted token; Authenticated Users deny-only; fixed executable and clean environment; per-task Job Object with KILL_ON_JOB_CLOSE; private inherited stdio.'
    codexPin = 'Record exact protected Codex EXE path, version output, SHA-256 and task working-directory policy; never reference main-user profile or credentials.'
    auth = 'Independent codex login --device-auth under TongCodexWorker; never copy the main user profile or token.'
    network = 'No firewall change. Codex inference requires outbound network; exfiltration remains possible.'
    unchangedNow = @('DevSpace/Gateway/ngrok processes and ports', 'OAuth configuration', 'system PATH/environment', 'firewall', 'other project ACLs')
    firstInstallGate = 'Keep MCP launcher disabled and service Manual. Separately approve Gateway service identity change and independent-account canaries before any live Codex task or Automatic startup.'
    note = 'This output is a review plan, not an installer. No system object was changed.'
}
$plan | ConvertTo-Json -Depth 8
