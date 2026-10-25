$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# Keep fixture paths out of the invoking shell's command line: the native
# inventory correctly regards a live command mentioning that root as unknown.
$env:TONG_024_MONITOR_ROOT='D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a'
$env:TONG_024_MONITOR_CANDIDATE='37dc649c46ad0e267c3471f750b97227cf106310'
& (Join-Path $PSScriptRoot 'Test-Tong024FormalMonitor.ps1') -Cycles 2
