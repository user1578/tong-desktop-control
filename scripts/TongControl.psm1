Set-StrictMode -Version Latest
$script:ProjectRoot = Split-Path -Parent $PSScriptRoot
$script:RuntimePath = Join-Path $script:ProjectRoot 'runtime'
$script:LogPath = Join-Path $script:ProjectRoot 'logs'

function Get-TongConfiguration {
    $path = Join-Path $script:ProjectRoot 'config\tong.config.json'
    if (-not (Test-Path -LiteralPath $path)) {
        throw 'Missing config\tong.config.json. Copy config\tong.config.example.json and set local paths.'
    }

    $raw = Get-Content -LiteralPath $path -Raw -Encoding utf8
    $settings = $raw | ConvertFrom-Json
    $origin = [uri]$settings.publicOrigin
    if ($origin.Scheme -ne 'https' -or $origin.AbsolutePath -ne '/' -or $origin.Query -or $origin.Fragment) {
        throw 'publicOrigin must be an HTTPS origin without a path, query, or fragment.'
    }

    $expectedWorkspace = [IO.Path]::GetFullPath((Join-Path $script:ProjectRoot 'demo-workspace'))
    $workspace = [IO.Path]::GetFullPath([string]$settings.workspacePath)
    if (-not [string]::Equals($workspace, $expectedWorkspace, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'workspacePath must remain the project demo-workspace directory.'
    }
    if ([int]$settings.port -ne 7676) {
        throw 'This deployment is configured for DevSpace port 7676.'
    }

    [pscustomobject]@{
        PublicOrigin = $origin.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
        Port = [int]$settings.port
        DevSpacePort = 7677
        WorkspacePath = $workspace
        PublicMcpUrl = ($origin.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/') + '/mcp')
        LocalMcpUrl = "http://127.0.0.1:$([int]$settings.port)/mcp"
        DevSpaceMcpUrl = "http://127.0.0.1:7677/mcp"
    }
}

function Get-TongDevSpacePaths {
    $node = Get-Command node.exe -ErrorAction Stop
    $cli = Join-Path $script:ProjectRoot 'node_modules\@waishnav\devspace\dist\cli.js'
    if (-not (Test-Path -LiteralPath $cli)) {
        throw 'DevSpace is not installed in this project. Run npm install from the project root.'
    }
    [pscustomobject]@{ Node = $node.Source; Cli = $cli }
}

function Get-TongDevSpaceConfigPath {
    $directory = Join-Path $env:USERPROFILE '.devspace'
    foreach ($name in @('config.json', 'config.jsonc')) {
        $path = Join-Path $directory $name
        if (Test-Path -LiteralPath $path) { return $path }
    }
    throw 'DevSpace user configuration is missing. Run the DevSpace initializer first.'
}

function Get-TongDevSpaceConfig {
    $path = Get-TongDevSpaceConfigPath
    try {
        $settings = Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json
    }
    catch {
        throw "Could not read DevSpace configuration at $path."
    }
    $expected = [IO.Path]::GetFullPath((Join-Path $script:ProjectRoot 'demo-workspace'))
    $roots = @($settings.allowedRoots | ForEach-Object { [IO.Path]::GetFullPath([string]$_) })
    if ($roots.Count -ne 1 -or -not [string]::Equals($roots[0], $expected, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'DevSpace must have exactly one allowed root: demo-workspace. Re-run the initializer to correct it.'
    }
    if ($settings.subagents.enabled -or @($settings.subagents.providers | Where-Object { $_.enabled }).Count -gt 0) {
        throw 'DevSpace subagents must remain disabled for this phase.'
    }
    $settings
}

function Sync-TongPublicOrigin {
    param([Parameter(Mandatory)]$Settings)

    $devConfig = Get-TongDevSpaceConfig
    if ($devConfig.publicBaseUrl.TrimEnd('/') -eq $Settings.PublicOrigin) { return }

    $paths = Get-TongDevSpacePaths
    & $paths.Node $paths.Cli config set publicBaseUrl $Settings.PublicOrigin | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'DevSpace could not save the public origin. Check the DevSpace config and logs.'
    }
    $updated = Get-TongDevSpaceConfig
    if ($updated.publicBaseUrl.TrimEnd('/') -ne $Settings.PublicOrigin) {
        throw 'The DevSpace public origin did not match the project configuration after update.'
    }
}

function Initialize-TongRuntimeDirectories {
    New-Item -ItemType Directory -Path $script:RuntimePath -Force | Out-Null
    New-Item -ItemType Directory -Path $script:LogPath -Force | Out-Null
}

function Get-TongRecordPath {
    param([ValidateSet('devspace', 'gateway')][string]$Name)
    Join-Path $script:RuntimePath "$Name.json"
}

function Get-TongManagedProcess {
    param([ValidateSet('devspace', 'gateway')][string]$Name)

    $recordPath = Get-TongRecordPath $Name
    if (-not (Test-Path -LiteralPath $recordPath)) { return $null }
    $record = Get-Content -LiteralPath $recordPath -Raw -Encoding utf8 | ConvertFrom-Json
    $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $([int]$record.processId)" -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        Remove-Item -LiteralPath $recordPath -Force
        return $null
    }

    if (-not [string]::Equals([string]$process.ExecutablePath, [string]$record.executablePath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "PID $($record.processId) no longer identifies the $Name process started by this project; it was left untouched."
    }
    if ([string]$process.CommandLine -notlike "*$($record.commandMarker)*") {
        throw "PID $($record.processId) does not match the recorded $Name command; it was left untouched."
    }
    [pscustomobject]@{ Process = $process; Record = $record }
}

function Get-TongPortListeners {
    param([int]$Port)
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    return ,$listeners
}

function Wait-TongPort {
    param([int]$Port, [int]$ProcessId, [string]$Service)
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $listeners = Get-TongPortListeners $Port
        $ownedListener = $false
        if ($listeners.Count -gt 0) {
            $ownedListener = @($listeners | Where-Object { $_.OwningProcess -eq $ProcessId }).Count -gt 0
        }
        if ($ownedListener) { return }
        $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($null -eq $process) { throw "$Service exited before its port became ready. See the project logs directory." }
        if ($listeners.Count -gt 0) {
            $owner = ($listeners | ForEach-Object { $_.OwningProcess } | Sort-Object -Unique) -join ', '
            throw "Port $Port was claimed by another process (PID $owner). No process was stopped."
        }
        Start-Sleep -Milliseconds 500
    }
    throw "$Service did not listen on port $Port in 20 seconds. See the project logs directory."
}

function Start-TongDevSpace {
    param($Settings)

    $paths = Get-TongDevSpacePaths
    $securityPatch = Join-Path $script:ProjectRoot 'scripts\Apply-TongDevSpacePatch.mjs'
    & $paths.Node $securityPatch --check | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The pinned DevSpace security patch is missing or changed.' }

    $existing = Get-TongManagedProcess 'devspace'
    if ($existing) {
        if ($existing.Record.publicOrigin -ne $Settings.PublicOrigin) {
            throw 'The managed DevSpace process uses a different origin. Stop it and start again.'
        }
        if ([int]$existing.Record.port -ne $Settings.DevSpacePort) {
            throw 'The managed DevSpace process uses the public gateway port. Run Restart-TongDesktopControl.ps1 to move it behind the gateway.'
        }
        $patchProperty = $existing.Record.PSObject.Properties['securityPatchVersion']
        if ($null -ne $patchProperty -and $patchProperty.Value -eq 'tong-1.0.8-p1-v2') {
            Wait-TongPort -Port $Settings.DevSpacePort -ProcessId $existing.Process.ProcessId -Service 'DevSpace'
            Write-Output "DevSpace already running (PID $($existing.Process.ProcessId)) on port $($Settings.DevSpacePort)."
            return
        }
        Stop-TongManagedProcess 'devspace'
    }

    $listeners = Get-TongPortListeners $Settings.DevSpacePort
    if ($listeners.Count -gt 0) {
        $owner = ($listeners | ForEach-Object { $_.OwningProcess } | Sort-Object -Unique) -join ', '
        throw "DevSpace upstream port $($Settings.DevSpacePort) is already in use by PID $owner. No process was stopped."
    }

    $httpDiagnostics = Join-Path $script:ProjectRoot 'scripts\TongDevSpaceHttpDiagnostics.mjs'
    if (-not (Test-Path -LiteralPath $httpDiagnostics)) { throw 'DevSpace HTTP diagnostics script is missing.' }
    $httpDiagnosticsUrl = ([uri]$httpDiagnostics).AbsoluteUri
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $script:LogPath "devspace-$stamp.stdout.log"
    $stderr = Join-Path $script:LogPath "devspace-$stamp.stderr.log"
    $oldSkills = $env:DEVSPACE_SKILLS
    $oldSubagents = $env:DEVSPACE_SUBAGENTS
    $oldToolMode = $env:DEVSPACE_TOOL_MODE
    $oldArtifacts = $env:DEVSPACE_ARTIFACTS
    $oldAgentDir = $env:DEVSPACE_AGENT_DIR
    $oldRestricted = $env:TONG_RESTRICTED_MCP
    $oldRestrictedRoot = $env:TONG_RESTRICTED_ROOT
    $oldPort = $env:PORT
    $oldHost = $env:HOST
    try {
        $env:DEVSPACE_SKILLS = '0'
        $env:DEVSPACE_SUBAGENTS = '0'
        $env:DEVSPACE_TOOL_MODE = 'minimal'
        $env:DEVSPACE_ARTIFACTS = '0'
        $env:DEVSPACE_AGENT_DIR = $Settings.WorkspacePath
        $env:TONG_RESTRICTED_MCP = '1'
        $env:TONG_RESTRICTED_ROOT = $Settings.WorkspacePath
        $env:PORT = [string]$Settings.DevSpacePort
        $env:HOST = '127.0.0.1'
        $process = Start-Process -FilePath $paths.Node -ArgumentList @('--import', $httpDiagnosticsUrl, $paths.Cli, 'serve') `
            -WorkingDirectory $script:ProjectRoot -RedirectStandardOutput $stdout `
            -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
    }
    finally {
        if ($null -eq $oldSkills) { Remove-Item Env:\DEVSPACE_SKILLS -ErrorAction SilentlyContinue } else { $env:DEVSPACE_SKILLS = $oldSkills }
        if ($null -eq $oldSubagents) { Remove-Item Env:\DEVSPACE_SUBAGENTS -ErrorAction SilentlyContinue } else { $env:DEVSPACE_SUBAGENTS = $oldSubagents }
        if ($null -eq $oldToolMode) { Remove-Item Env:\DEVSPACE_TOOL_MODE -ErrorAction SilentlyContinue } else { $env:DEVSPACE_TOOL_MODE = $oldToolMode }
        if ($null -eq $oldArtifacts) { Remove-Item Env:\DEVSPACE_ARTIFACTS -ErrorAction SilentlyContinue } else { $env:DEVSPACE_ARTIFACTS = $oldArtifacts }
        if ($null -eq $oldAgentDir) { Remove-Item Env:\DEVSPACE_AGENT_DIR -ErrorAction SilentlyContinue } else { $env:DEVSPACE_AGENT_DIR = $oldAgentDir }
        if ($null -eq $oldRestricted) { Remove-Item Env:\TONG_RESTRICTED_MCP -ErrorAction SilentlyContinue } else { $env:TONG_RESTRICTED_MCP = $oldRestricted }
        if ($null -eq $oldRestrictedRoot) { Remove-Item Env:\TONG_RESTRICTED_ROOT -ErrorAction SilentlyContinue } else { $env:TONG_RESTRICTED_ROOT = $oldRestrictedRoot }
        if ($null -eq $oldPort) { Remove-Item Env:\PORT -ErrorAction SilentlyContinue } else { $env:PORT = $oldPort }
        if ($null -eq $oldHost) { Remove-Item Env:\HOST -ErrorAction SilentlyContinue } else { $env:HOST = $oldHost }
    }

    $processInfo = Get-Process -Id $process.Id -ErrorAction Stop
    $record = [ordered]@{
        processId = $process.Id
        processStartUtcTicks = $processInfo.StartTime.ToUniversalTime().Ticks
        executablePath = $paths.Node
        commandMarker = $paths.Cli
        publicOrigin = $Settings.PublicOrigin
        port = $Settings.DevSpacePort
        securityPatchVersion = 'tong-1.0.8-p1-v2'
        startedAt = (Get-Date).ToString('o')
        stdoutLog = $stdout
        stderrLog = $stderr
    }
    $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Get-TongRecordPath 'devspace') -Encoding utf8
    Wait-TongPort -Port $Settings.DevSpacePort -ProcessId $process.Id -Service 'DevSpace'
    Write-Output "DevSpace started (PID $($process.Id)) on port $($Settings.DevSpacePort)."
}

function Start-TongGateway {
    param($Settings)

    $existing = Get-TongManagedProcess 'gateway'
    if ($existing) {
        $gatewayVersion = $existing.Record.PSObject.Properties['toolPolicyVersion']
        if ($existing.Record.publicOrigin -ne $Settings.PublicOrigin -or [int]$existing.Record.port -ne $Settings.Port -or
            $null -eq $gatewayVersion -or $gatewayVersion.Value -ne 'tong-p1-tools-v1') {
            Stop-TongManagedProcess 'gateway'
        }
        else {
            Wait-TongPort -Port $Settings.Port -ProcessId $existing.Process.ProcessId -Service 'MCP gateway'
            Write-Output "MCP gateway already running (PID $($existing.Process.ProcessId))."
            return
        }
    }

    $listeners = Get-TongPortListeners $Settings.Port
    if ($listeners.Count -gt 0) {
        $owner = ($listeners | ForEach-Object { $_.OwningProcess } | Sort-Object -Unique) -join ', '
        throw "Gateway port $($Settings.Port) is already in use by PID $owner. No process was stopped."
    }

    $paths = Get-TongDevSpacePaths
    $gatewayScript = Join-Path $script:ProjectRoot 'scripts\TongMcpGateway.mjs'
    if (-not (Test-Path -LiteralPath $gatewayScript)) { throw 'The restricted MCP gateway script is missing.' }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $script:LogPath "gateway-$stamp.stdout.log"
    $stderr = Join-Path $script:LogPath "gateway-$stamp.stderr.log"
    $process = Start-Process -FilePath $paths.Node -ArgumentList @($gatewayScript) `
        -WorkingDirectory $script:ProjectRoot -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
    $processInfo = Get-Process -Id $process.Id -ErrorAction Stop
    $record = [ordered]@{
        processId = $process.Id
        processStartUtcTicks = $processInfo.StartTime.ToUniversalTime().Ticks
        executablePath = $paths.Node
        commandMarker = $gatewayScript
        publicOrigin = $Settings.PublicOrigin
        port = $Settings.Port
        toolPolicyVersion = 'tong-p1-tools-v1'
        startedAt = (Get-Date).ToString('o')
        stdoutLog = $stdout
        stderrLog = $stderr
    }
    $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Get-TongRecordPath 'gateway') -Encoding utf8
    Wait-TongPort -Port $Settings.Port -ProcessId $process.Id -Service 'MCP gateway'
    Write-Output "MCP gateway started (PID $($process.Id)); local MCP: $($Settings.LocalMcpUrl)."
}

function Stop-TongManagedProcess {
    param([ValidateSet('devspace', 'gateway')][string]$Name)

    $recordPath = Get-TongRecordPath $Name
    $managed = Get-TongManagedProcess $Name
    if (-not $managed) {
        Write-Output "$Name is not running under this project's process record."
        return
    }

    $process = Get-Process -Id $managed.Process.ProcessId -ErrorAction Stop
    if ($process.StartTime.ToUniversalTime().Ticks -ne [long]$managed.Record.processStartUtcTicks) {
        throw "PID $($process.Id) was reused; it was left untouched."
    }
    Stop-Process -InputObject $process -ErrorAction Stop
    try { $process.WaitForExit(10000) | Out-Null } catch { }
    if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
        throw "$Name PID $($process.Id) did not stop; its process record was retained."
    }
    Remove-Item -LiteralPath $recordPath -Force
    Write-Output "$Name stopped (PID $($process.Id))."
}

function Start-TongDesktopControl {
    $settings = Get-TongConfiguration
    if (-not (Test-Path -LiteralPath $settings.WorkspacePath)) { throw 'demo-workspace is missing.' }
    if (-not (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.devspace\auth.json'))) {
        throw 'DevSpace authentication is not initialized. Run the approved DevSpace initializer.'
    }
    $null = Get-TongDevSpaceConfig
    Initialize-TongRuntimeDirectories

    $server = Get-TongManagedProcess 'devspace'
    $gateway = Get-TongManagedProcess 'gateway'
    if (($server -and ($server.Record.publicOrigin -ne $settings.PublicOrigin -or [int]$server.Record.port -ne $settings.DevSpacePort)) -or
        ($gateway -and ($gateway.Record.publicOrigin -ne $settings.PublicOrigin -or [int]$gateway.Record.port -ne $settings.Port))) {
        Stop-TongManagedProcess 'gateway'
        Stop-TongManagedProcess 'devspace'
    }
    Sync-TongPublicOrigin -Settings $settings
    Start-TongDevSpace -Settings $settings
    Start-TongGateway -Settings $settings
}

function Stop-TongDesktopControl {
    Stop-TongManagedProcess 'gateway'
    Stop-TongManagedProcess 'devspace'
}

function Get-TongDesktopControlStatus {
    $settings = Get-TongConfiguration
    $server = Get-TongManagedProcess 'devspace'
    $gateway = Get-TongManagedProcess 'gateway'
    $listeners = Get-TongPortListeners $settings.Port
    $upstreamListeners = Get-TongPortListeners $settings.DevSpacePort
    $serverState = if ($server) { "running (PID $($server.Process.ProcessId)) on port $($settings.DevSpacePort)" } elseif ($upstreamListeners.Count -gt 0) { "occupied by untracked PID $($upstreamListeners[0].OwningProcess)" } else { 'stopped' }
    $gatewayState = if ($gateway) { "running (PID $($gateway.Process.ProcessId)) on port $($settings.Port)" } elseif ($listeners.Count -gt 0) { "occupied by untracked PID $($listeners[0].OwningProcess)" } else { 'stopped' }
    [pscustomobject]@{
        DevSpace = $serverState
        Gateway = $gatewayState
        LocalMcp = $settings.LocalMcpUrl
        DevSpaceUpstream = $settings.DevSpaceMcpUrl
        Ngrok = 'external Windows service; not managed by Tong'
        PublicMcp = $settings.PublicMcpUrl
        Logs = $script:LogPath
    } | Format-List
}

Export-ModuleMember -Function Get-TongConfiguration, Start-TongDesktopControl, Stop-TongDesktopControl, Get-TongDesktopControlStatus
