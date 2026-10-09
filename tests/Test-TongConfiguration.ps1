$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$projectConfigPath = Join-Path $projectRoot 'config\tong.config.json'
$devspaceConfigPath = Join-Path $env:USERPROFILE '.devspace\config.json'

if (-not (Test-Path -LiteralPath $projectConfigPath)) {
    throw 'Missing config\tong.config.json.'
}
if (-not (Test-Path -LiteralPath $devspaceConfigPath)) {
    throw 'DevSpace has not been initialized for this user.'
}

$projectConfig = Get-Content -LiteralPath $projectConfigPath -Raw -Encoding utf8 | ConvertFrom-Json
$devspaceConfig = Get-Content -LiteralPath $devspaceConfigPath -Raw -Encoding utf8 | ConvertFrom-Json
Import-Module (Join-Path $PSScriptRoot '..\scripts\TongControl.psm1') -Force
$runtimeSettings = Get-TongConfiguration
$expectedWorkspace = Join-Path $projectRoot 'demo-workspace'
$expectedOrigin = [uri]$projectConfig.publicOrigin

if ($expectedOrigin.Scheme -ne 'https' -or $expectedOrigin.AbsolutePath -ne '/') {
    throw 'publicOrigin must be an HTTPS origin without a path.'
}
if ([IO.Path]::GetFullPath($projectConfig.workspacePath) -ne [IO.Path]::GetFullPath($expectedWorkspace)) {
    throw 'The project configuration must point only to demo-workspace.'
}
if ([int]$projectConfig.port -ne [int]$devspaceConfig.port) {
    throw 'Project and DevSpace ports do not match.'
}
if ([int]$runtimeSettings.DevSpacePort -ne 7677) {
    throw 'DevSpace must stay behind the restricted MCP gateway on loopback port 7677.'
}
if (@($devspaceConfig.allowedRoots).Count -ne 1 -or
    [IO.Path]::GetFullPath($devspaceConfig.allowedRoots[0]) -ne [IO.Path]::GetFullPath($expectedWorkspace)) {
    throw 'DevSpace must allow only demo-workspace.'
}
if ($devspaceConfig.publicBaseUrl.TrimEnd('/') -ne $expectedOrigin.GetLeftPart([System.UriPartial]::Authority)) {
    throw 'Project and DevSpace public origins do not match.'
}
if ($devspaceConfig.subagents.enabled -or @($devspaceConfig.subagents.providers | Where-Object enabled).Count -gt 0) {
    throw 'DevSpace subagents must remain disabled for this phase.'
}
if (-not (Test-Path -LiteralPath $projectConfig.ngrokExecutable) -or
    -not (Test-Path -LiteralPath $projectConfig.ngrokConfigPath)) {
    throw 'The configured ngrok executable or existing ngrok config is missing.'
}

Write-Output 'PASS: project origin and DevSpace origin match.'
Write-Output 'PASS: DevSpace is restricted to demo-workspace.'
Write-Output 'PASS: DevSpace subagents are disabled.'
Write-Output 'PASS: DevSpace upstream stays behind the restricted loopback gateway.'
Write-Output 'PASS: configured ngrok executable and config file exist.'
