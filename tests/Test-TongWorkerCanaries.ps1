$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') { throw 'This canary test requires Windows.' }

$root = Join-Path ([IO.Path]::GetTempPath()) ('TongWorkerCanary-' + [guid]::NewGuid().ToString('N'))
$project = Join-Path $root 'authorized-project'
$other = Join-Path $root 'other-project'
$private = Join-Path $root 'synthetic-private-profile'
$auth = Join-Path $root 'synthetic-tong-auth'
$workerProfile = Join-Path $root 'synthetic-worker-profile'
$workerTemp = Join-Path $root 'synthetic-worker-temp'
$resultFile = Join-Path $root 'authorized-project\result.json'
$createdSyntheticEnvironmentMarker = $false

try {
    [void](New-Item -ItemType Directory -Path $root)
    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $rootAcl = Get-Acl -LiteralPath $root
    $rootAcl.SetAccessRuleProtection($true, $false)
    $rootInheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($sid in @($currentSid, 'S-1-5-18', 'S-1-5-32-544')) {
        $identity = [System.Security.Principal.SecurityIdentifier]::new($sid)
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $identity, [System.Security.AccessControl.FileSystemRights]::FullControl, $rootInheritance,
            [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
        [void]$rootAcl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $root -AclObject $rootAcl
    foreach ($directory in @($project, $other, $private, $auth, $workerProfile, $workerTemp)) {
        [void](New-Item -ItemType Directory -Path $directory)
    }
    $sidPrefix = $currentSid.Substring(0, $currentSid.LastIndexOf('-'))
    $restrictingSid = "$sidPrefix-$((Get-Random -Minimum 50000 -Maximum 2000000000))"
    $restrictingIdentity = [System.Security.Principal.SecurityIdentifier]::new($restrictingSid)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $accessRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $restrictingIdentity, [System.Security.AccessControl.FileSystemRights]::Modify, $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $usersIdentity = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
    $usersRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $usersIdentity, [System.Security.AccessControl.FileSystemRights]::Modify, $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    foreach ($directory in @($project, $other, $private, $auth)) {
        [IO.File]::WriteAllText((Join-Path $directory 'canary.txt'), "synthetic canary: $([IO.Path]::GetFileName($directory))")
    }
    [IO.File]::WriteAllText((Join-Path $project 'delete.canary'), 'synthetic authorized delete canary')
    [void](New-Item -ItemType Junction -Path (Join-Path $project 'outside-link') -Target $other)
    foreach ($directory in @($project, $workerProfile, $workerTemp)) {
        $acl = Get-Acl -LiteralPath $directory
        [void]$acl.AddAccessRule($accessRule)
        [void]$acl.AddAccessRule($usersRule)
        Set-Acl -LiteralPath $directory -AclObject $acl
    }
    foreach ($directory in @($other, $private, $auth)) {
        # Model the D: tree's Authenticated Users grant, which the test token marks deny-only.
        $outsideSids = if ($directory -eq $other) { @('S-1-5-11') } else { @('S-1-5-18', 'S-1-5-32-544') }
        $outsideRules = foreach ($sid in $outsideSids) {
            $identity = [System.Security.Principal.SecurityIdentifier]::new($sid)
            [System.Security.AccessControl.FileSystemAccessRule]::new(
                $identity, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance,
                [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
        }
        $canaryPath = Join-Path $directory 'canary.txt'
        $fileAcl = Get-Acl -LiteralPath $canaryPath
        $fileAcl.SetAccessRuleProtection($true, $false)
        foreach ($sid in $outsideSids) {
            $identity = [System.Security.Principal.SecurityIdentifier]::new($sid)
            $fileRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
                $identity, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.InheritanceFlags]::None,
                [System.Security.AccessControl.PropagationFlags]::None,
                [System.Security.AccessControl.AccessControlType]::Allow)
            [void]$fileAcl.AddAccessRule($fileRule)
        }
        Set-Acl -LiteralPath $canaryPath -AclObject $fileAcl
        $acl = Get-Acl -LiteralPath $directory
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($rule in $outsideRules) { [void]$acl.AddAccessRule($rule) }
        Set-Acl -LiteralPath $directory -AclObject $acl
    }

    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class TongRestrictedProcessProbe {
    [StructLayout(LayoutKind.Sequential)]
    private struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFO {
        public uint cb; public IntPtr lpReserved; public IntPtr lpDesktop; public IntPtr lpTitle;
        public uint dwX; public uint dwY; public uint dwXSize; public uint dwYSize;
        public uint dwXCountChars; public uint dwYCountChars; public uint dwFillAttribute;
        public uint dwFlags; public ushort wShowWindow; public ushort cbReserved2;
        public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS {
        public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount;
        public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateJobObjectW")]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int informationClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information, uint informationLength);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool CreateRestrictedToken(
        IntPtr existingToken, uint flags, uint disableSidCount, IntPtr sidsToDisable,
        uint deletePrivilegeCount, IntPtr privilegesToDelete, uint restrictedSidCount,
        IntPtr sidsToRestrict, out IntPtr newToken);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSidToSid(string stringSid, out IntPtr sid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessAsUser(IntPtr token, string applicationName,
        StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory,
        ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

    public static int Run(string commandLine, string currentDirectory, string[] environmentEntries,
            string restrictingSid, string userSid) {
        IntPtr sourceToken = IntPtr.Zero, restrictedToken = IntPtr.Zero;
        IntPtr everyoneSid = IntPtr.Zero, usersSid = IntPtr.Zero, authenticatedUsersSid = IntPtr.Zero;
        IntPtr restrictedCodeSid = IntPtr.Zero, uniqueSid = IntPtr.Zero, currentUserSid = IntPtr.Zero;
        IntPtr disabledSidArray = IntPtr.Zero, sidArray = IntPtr.Zero, environment = IntPtr.Zero, job = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        try {
            const uint TOKEN_ASSIGN_PRIMARY = 0x0001, TOKEN_DUPLICATE = 0x0002, TOKEN_QUERY = 0x0008;
            const uint TOKEN_ADJUST_DEFAULT = 0x0080, TOKEN_ADJUST_SESSIONID = 0x0100;
            const uint DISABLE_MAX_PRIVILEGE = 0x00000001, CREATE_NO_WINDOW = 0x08000000;
            const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400, CREATE_SUSPENDED = 0x00000004;
            const uint WAIT_OBJECT_0 = 0x00000000, WAIT_TIMEOUT = 0x00000102;
            const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
            uint tokenAccess = TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT | TOKEN_ADJUST_SESSIONID;
            if (!OpenProcessToken(GetCurrentProcess(), tokenAccess, out sourceToken)) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcessToken failed");
            if (!ConvertStringSidToSid("S-1-1-0", out everyoneSid)
                    || !ConvertStringSidToSid("S-1-5-32-545", out usersSid)
                    || !ConvertStringSidToSid("S-1-5-11", out authenticatedUsersSid)
                    || !ConvertStringSidToSid("S-1-5-12", out restrictedCodeSid)
                    || !ConvertStringSidToSid(restrictingSid, out uniqueSid)
                    || !ConvertStringSidToSid(userSid, out currentUserSid))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not create synthetic restricting SIDs");
            int itemSize = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
            disabledSidArray = Marshal.AllocHGlobal(itemSize);
            Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid = authenticatedUsersSid, Attributes = 0 }, disabledSidArray, false);
            sidArray = Marshal.AllocHGlobal(itemSize * 6);
            Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid = everyoneSid, Attributes = 0 }, sidArray, false);
            Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid = usersSid, Attributes = 0 }, IntPtr.Add(sidArray, itemSize), false);
            Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid = authenticatedUsersSid, Attributes = 0 }, IntPtr.Add(sidArray, itemSize * 2), false);
            Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid = restrictedCodeSid, Attributes = 0 }, IntPtr.Add(sidArray, itemSize * 3), false);
            Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid = currentUserSid, Attributes = 0 }, IntPtr.Add(sidArray, itemSize * 4), false);
            Marshal.StructureToPtr(new SID_AND_ATTRIBUTES { Sid = uniqueSid, Attributes = 0 }, IntPtr.Add(sidArray, itemSize * 5), false);
            if (!CreateRestrictedToken(sourceToken, DISABLE_MAX_PRIVILEGE, 1, disabledSidArray, 0, IntPtr.Zero,
                    6, sidArray, out restrictedToken))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateRestrictedToken failed");

            Array.Sort(environmentEntries, StringComparer.OrdinalIgnoreCase);
            string environmentText = String.Join("\0", environmentEntries) + "\0\0";
            environment = Marshal.StringToHGlobalUni(environmentText);
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject failed");
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION jobLimits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            jobLimits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            uint jobLimitsSize = (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            if (!SetInformationJobObject(job, 9, ref jobLimits, jobLimitsSize))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Setting Job Object kill-on-close failed");
            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
            StringBuilder mutableCommandLine = new StringBuilder(commandLine);
            if (!CreateProcessAsUser(restrictedToken, null, mutableCommandLine, IntPtr.Zero, IntPtr.Zero,
                    false, CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED, environment, currentDirectory,
                    ref startup, out process))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessAsUser with the restricted token failed");
            if (!AssignProcessToJobObject(job, process.hProcess)) {
                TerminateProcess(process.hProcess, 125);
                throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject failed");
            }
            if (ResumeThread(process.hThread) == 0xffffffff) {
                TerminateProcess(process.hProcess, 126);
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Resuming restricted Worker process failed");
            }
            uint wait = WaitForSingleObject(process.hProcess, 300000);
            if (wait == WAIT_TIMEOUT) {
                TerminateProcess(process.hProcess, 124);
                throw new TimeoutException("Restricted Worker canary process exceeded five minutes");
            }
            if (wait != WAIT_OBJECT_0) throw new Win32Exception(Marshal.GetLastWin32Error(), "Waiting for restricted Worker failed");
            uint exitCode;
            if (!GetExitCodeProcess(process.hProcess, out exitCode)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not read Worker exit code");
            return unchecked((int)exitCode);
        } finally {
            if (job != IntPtr.Zero) CloseHandle(job);
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            if (sidArray != IntPtr.Zero) Marshal.FreeHGlobal(sidArray);
            if (disabledSidArray != IntPtr.Zero) Marshal.FreeHGlobal(disabledSidArray);
            if (restrictedToken != IntPtr.Zero) CloseHandle(restrictedToken);
            if (sourceToken != IntPtr.Zero) CloseHandle(sourceToken);
            if (uniqueSid != IntPtr.Zero) LocalFree(uniqueSid);
            if (authenticatedUsersSid != IntPtr.Zero) LocalFree(authenticatedUsersSid);
            if (currentUserSid != IntPtr.Zero) LocalFree(currentUserSid);
            if (restrictedCodeSid != IntPtr.Zero) LocalFree(restrictedCodeSid);
            if (usersSid != IntPtr.Zero) LocalFree(usersSid);
            if (everyoneSid != IntPtr.Zero) LocalFree(everyoneSid);
        }
    }
}
'@

    $nodePath = Get-Command node.exe -CommandType Application | Select-Object -First 1 -ExpandProperty Source
    if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Node.js executable was not found.' }
    $workerNode = Join-Path $project 'node.exe'
    $workerScript = Join-Path $project 'TongWorkerCanary.mjs'
    Copy-Item -LiteralPath $nodePath -Destination $workerNode
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixtures\TongWorkerCanary.mjs') -Destination $workerScript
    $quote = { param([string]$Value) '"' + $Value + '"' }
    $arguments = @(
        (& $quote $workerScript), 'worker', (& $quote $project), (& $quote $other),
        (& $quote $private), (& $quote $auth), (& $quote $resultFile)
    ) -join ' '
    $commandLine = (& $quote $workerNode) + ' ' + $arguments
    $systemRoot = $env:SystemRoot
    $safeEnvironment = @(
        "SystemRoot=$systemRoot", "WINDIR=$systemRoot", "SystemDrive=$($env:SystemDrive)",
        "USERPROFILE=$workerProfile", "HOME=$workerProfile", "APPDATA=$workerProfile\AppData\Roaming",
        "LOCALAPPDATA=$workerProfile\AppData\Local", "TEMP=$workerTemp", "TMP=$workerTemp",
        "PATH=$systemRoot\System32;$systemRoot", "PATHEXT=.COM;.EXE;.BAT;.CMD",
        "ComSpec=$systemRoot\System32\cmd.exe"
    )
    $env:TONG_SYNTHETIC_SECRET_CANARY = 'synthetic-only-marker'
    $createdSyntheticEnvironmentMarker = $true
    $exitCode = [TongRestrictedProcessProbe]::Run($commandLine, (Join-Path $systemRoot 'System32'),
        $safeEnvironment, $restrictingSid, $currentSid)
    if ($exitCode -ne 0) { throw "Restricted Worker canary process exited with code $exitCode." }
    $result = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
    if (-not [int]$result.lingerPid) { throw 'Worker did not start the synthetic Job Object lifetime canary.' }
    $lingeringChildAlive = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $lingeringChildAlive = [bool](Get-Process -Id ([int]$result.lingerPid) -ErrorAction SilentlyContinue)
        if (-not $lingeringChildAlive) { break }
        Start-Sleep -Milliseconds 100
    }
    if ($lingeringChildAlive) { throw 'Job Object close did not terminate the lingering Worker child process.' }

    $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
    foreach ($directory in @($other, $private, $auth)) {
        & $icacls $directory '/grant' "*${currentSid}:F" '/T' '/C' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not restore access to a synthetic canary directory.' }
    }

    $expected = @{
        projectRead = 'allowed'; projectWrite = 'allowed'; projectDelete = 'allowed'
        otherRead = 'denied'; otherWrite = 'denied'; otherDelete = 'denied'
        privateRead = 'denied'; privateWrite = 'denied'; privateDelete = 'denied'
        authRead = 'denied'; authWrite = 'denied'; authDelete = 'denied'
        junctionRead = 'denied'; syntheticSecretInherited = $false
        openAiKeyInherited = $false; codexTokenInherited = $false
    }
    foreach ($key in $expected.Keys) {
        $actual = $result.PSObject.Properties[$key].Value
        if ($actual -ne $expected[$key]) { throw "Canary check '$key' expected '$($expected[$key])', got '$actual'." }
    }
    if ($result.childExitCode -ne 0 -or $result.child.childProjectWrite -ne 'allowed' -or
        $result.child.childOtherRead -ne 'denied' -or
        -not (Test-Path -LiteralPath (Join-Path $project 'child-write.canary'))) {
        throw 'A child process did not retain the restricted Worker access boundary.'
    }
    foreach ($file in @((Join-Path $other 'canary.txt'), (Join-Path $private 'canary.txt'), (Join-Path $auth 'canary.txt'))) {
        if (-not (Test-Path -LiteralPath $file)) { throw 'An outside synthetic canary was unexpectedly deleted.' }
        if ((Get-Content -LiteralPath $file -Raw) -notlike 'synthetic canary:*') {
            throw 'An outside synthetic canary was unexpectedly modified.'
        }
    }
    [pscustomobject]@{
        RestrictedTokenCreated = $true
        AuthorizedProjectReadWriteDelete = 'passed'
        OtherProjectPrivateAndAuthCanaries = 'read/write/delete denied'
        JunctionEscape = 'denied'
        ChildProcessInheritedRestriction = 'passed'
        JobObjectKillOnClose = 'passed'
        SensitiveEnvironmentInheritance = 'synthetic marker, OPENAI_API_KEY, and CODEX_ACCESS_TOKEN absent'
        SystemAccountOrAclChanges = 'none; only ACLs under a temporary synthetic directory were changed'
    } | ConvertTo-Json -Depth 4
} finally {
    if ($createdSyntheticEnvironmentMarker) { Remove-Item Env:TONG_SYNTHETIC_SECRET_CANARY -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $root) {
        foreach ($directory in @($other, $private, $auth)) {
            if (Test-Path -LiteralPath $directory) {
                try {
                    & (Join-Path $env:SystemRoot 'System32\icacls.exe') $directory '/grant' "*${currentSid}:F" '/T' '/C' | Out-Null
                } catch { }
            }
        }
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}
