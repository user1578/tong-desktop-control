param([string]$PocRoot = 'D:\agentdock-poc-20261010', [string]$GitPath, [string]$PythonPath)
$ErrorActionPreference = 'Stop'
$worktree = Split-Path -Parent $PSScriptRoot
$isolated = Join-Path $PocRoot 'isolated'
$exe = Join-Path $PocRoot 'runtime\agentdock.exe'
if (@(Get-NetTCPConnection -LocalPort 18765 -State Listen -ErrorAction SilentlyContinue).Count) { throw '18765 occupied; no existing process will be stopped' }
$aclPaths = @($PocRoot, (Join-Path $isolated 'state'), (Join-Path $isolated 'workspace'))
$before = @($aclPaths | ForEach-Object { (Get-Acl -LiteralPath $_).Sddl })
foreach ($target in $aclPaths[1..2]) { if (-not (Get-Acl -LiteralPath $target).AreAccessRulesProtected) { throw 'Expected previously approved protected PoC directories' } }
Get-ChildItem Env: | Where-Object Name -Like 'AGENTDOCK_*' | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
$env:AGENTDOCK_HOME = Join-Path $isolated 'state'
$env:AGENTDOCK_DEFAULT_DIR = Join-Path $isolated 'workspace'
$env:AGENTDOCK_AUTH_TOKEN = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$env:AGENTDOCK_BROWSER_ENABLED = 'false'; $env:AGENTDOCK_ACP_ENABLED = 'false'; $env:AGENTDOCK_MCP_APPS_MODE = 'off'
$env:TEMP = Join-Path $isolated 'temp'; $env:TMP = $env:TEMP
$env:TONG_AGENTDOCK_LIVE = '1'; $env:TONG_AGENTDOCK_POC_ROOT = $PocRoot
$env:TONG_AGENTDOCK_TOKEN = $env:AGENTDOCK_AUTH_TOKEN; $env:TONG_AGENTDOCK_LIVE_PHASE = 'online'
$env:TONG_AGENTDOCK_TEST_GIT = if ($GitPath) { $GitPath } else { (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source }
$env:TONG_AGENTDOCK_TEST_PYTHON = if ($PythonPath) { $PythonPath } else { (Get-Command python.exe -CommandType Application | Select-Object -First 1).Source }
$owned = Start-Process -FilePath $exe -ArgumentList @('--host','127.0.0.1','--port','18765','--mcp-apps-mode','off') -WorkingDirectory $isolated -RedirectStandardOutput (Join-Path $isolated 'logs\p244-agentdock.stdout.log') -RedirectStandardError (Join-Path $isolated 'logs\p244-agentdock.stderr.log') -WindowStyle Hidden -PassThru
try {
    Start-Sleep -Seconds 1
    $listener = Get-NetTCPConnection -LocalPort 18765 -State Listen -ErrorAction Stop
    if ($listener.LocalAddress -ne '127.0.0.1' -or $listener.OwningProcess -ne $owned.Id) { throw 'Unexpected listener identity' }
    Push-Location -LiteralPath $worktree
    try {
        node tests\Test-TongAgentDockExecutionLive.mjs; if ($LASTEXITCODE -ne 0) { throw 'Online acceptance failed' }
        node tests\Test-TongAgentDockLive.mjs; if ($LASTEXITCODE -ne 0) { throw 'P2.4.3 read regression failed' }
    } finally { Pop-Location }
} finally {
    $running = Get-Process -Id $owned.Id -ErrorAction SilentlyContinue
    if ($running) { if ($running.Path -ne $exe) { throw 'PID identity mismatch' }; taskkill.exe /PID $owned.Id | Out-Null; Start-Sleep -Seconds 1 }
    Remove-Item -LiteralPath Env:AGENTDOCK_AUTH_TOKEN
}
if (Get-Process -Id $owned.Id -ErrorAction SilentlyContinue) { throw 'Owned instance still running' }
if (@(Get-NetTCPConnection -LocalPort 18765 -State Listen -ErrorAction SilentlyContinue).Count) { throw '18765 not released' }
$env:TONG_AGENTDOCK_LIVE_PHASE = 'offline'
Push-Location -LiteralPath $worktree
try {
    node tests\Test-TongAgentDockExecutionLive.mjs; if ($LASTEXITCODE -ne 0) { throw 'Offline acceptance failed' }
    node tests\Test-TongAgentDockLive.mjs; if ($LASTEXITCODE -ne 0) { throw 'P2.4.3 offline regression failed' }
} finally { Pop-Location; Remove-Item -LiteralPath Env:TONG_AGENTDOCK_TOKEN }
$after = @($aclPaths | ForEach-Object { (Get-Acl -LiteralPath $_).Sddl })
for ($i = 0; $i -lt $aclPaths.Count; $i++) { if ($before[$i] -ne $after[$i]) { throw 'Unexpected ACL change' } }
[pscustomobject]@{ProcessId=$owned.Id;Stopped=$true;Port18765Listeners=0;AclUnchanged=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $isolated 'evidence\p244-lifecycle.json') -Encoding utf8
Write-Output 'PASS: isolated lifecycle, loopback listener, unchanged approved ACLs, stopped instance and released port.'
