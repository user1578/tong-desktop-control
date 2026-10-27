$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
try {
    $target=[IO.Path]::GetFullPath([Console]::In.ReadToEnd().Trim())
    if(-not $target.StartsWith('D:\Tong\state\',[StringComparison]::OrdinalIgnoreCase)){throw 'scope'}
    $references=0;$unknown=0
    foreach($task in @(Get-ScheduledTask -ErrorAction Stop)) {
        foreach($action in $task.Actions){
            foreach($field in @('Execute','Arguments','WorkingDirectory')){
                $value=[string]$action.$field
                if($value.IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0){$references++}
            }
        }
    }
    foreach($service in @(Get-CimInstance Win32_Service -ErrorAction Stop)){
        if(([string]$service.PathName).IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0){$references++}
    }
    foreach($process in @(Get-CimInstance Win32_Process -ErrorAction Stop)){
        if($process.ProcessId -eq $PID){continue}
        if($process.Name -in @('node.exe','pwsh.exe','powershell.exe','TongLoginHost.exe') -and -not $process.CommandLine){$unknown++}
        if(([string]$process.CommandLine).IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or ([string]$process.ExecutablePath).IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0){$references++}
    }
    @{references=$references;unknown=$unknown;readOnly=$true}|ConvertTo-Json -Compress
}catch{[Console]::Error.WriteLine('CLEANUP_REFERENCE_CHECK_FAILED');exit 2}
