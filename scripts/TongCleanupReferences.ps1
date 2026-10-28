$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'TongCleanupComReferences.ps1')
. (Join-Path $PSScriptRoot 'TongCleanupTaskTrust.ps1')
try {
    $target=[IO.Path]::GetFullPath([Console]::In.ReadToEnd().Trim())
    if(-not $target.StartsWith('D:\Tong\state\',[StringComparison]::OrdinalIgnoreCase)){throw 'scope'}
    $references=0;$unknown=0;$comPaths=@{};$unknownComClasses=[Collections.Generic.HashSet[string]]::new();$warnings=[Collections.Generic.List[object]]::new()
    foreach($task in @(Get-ScheduledTask -ErrorAction Stop)) {
        foreach($action in $task.Actions){
            # Windows has native COM-handler tasks as well as executable tasks.
            # Their CIM fields differ; StrictMode must not turn every legitimate
            # COM handler into an enumeration failure. Unknown/incomplete action
            # metadata still makes the cleanup proof fail closed.
            $classProperty=$action.PSObject.Properties['CimClass']
            $kind=if($null -ne $classProperty){[string]$classProperty.Value.CimClassName}else{''}
            $fields=@(switch($kind){
                'MSFT_TaskExecAction' {'Execute';'Arguments';'WorkingDirectory'}
                'MSFT_TaskComHandlerAction' {'ClassId';'Data'}
            })
            if(-not $fields.Count -or @($fields|Where-Object {$null -eq $action.PSObject.Properties[$_]}).Count){$unknown++;continue}
            foreach($field in $fields){
                $value=[string]$action.PSObject.Properties[$field].Value
                if($value.IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0){$references++}
            }
            if($kind -eq 'MSFT_TaskComHandlerAction'){
                $id=[string]$action.ClassId
                $validId=[guid]::Empty
                if(-not [guid]::TryParse($id,[ref]$validId)){$unknown++;continue}
                if(-not $comPaths.ContainsKey($id)){
                    try{$comPaths[$id]=Get-CleanupComPaths $id}catch{$comPaths[$id]=$null}
                }
                $com=$comPaths[$id]
                $unresolved=$null -eq $com -or -not $com.registered -or $com.unresolved
                foreach($path in $(if($null -ne $com){$com.paths}else{@()})){
                    $literal=([string]$path).Replace('/','\')
                    if($literal.IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0){$references++;continue}
                    if(@([regex]::Matches([string]$path,'%([^%]+)%')|Where-Object {$_.Groups[1].Value -notin @('SystemRoot','windir','SystemDrive','ProgramFiles','ProgramFiles(x86)','CommonProgramFiles','CommonProgramFiles(x86)')}).Count){$unresolved=$true;continue}
                    $expanded=[Environment]::ExpandEnvironmentVariables([string]$path).Replace('/','\')
                    if($expanded -match '%[^%]+%'){$unresolved=$true;continue}
                    if($expanded.IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0){$references++}
                }
                if($null -ne $com -and $com.fatal){$unknown++;$null=$unknownComClasses.Add($validId.ToString('B'));continue}
                if($unresolved){
                    if(Test-CleanupProtectedSystemTask $task){
                        if($warnings.Count -ge 16){throw 'COM_WARNING_LIMIT'}
                        $warnings.Add([pscustomobject]@{code='TRUSTED_SYSTEM_COM_UNRESOLVED';classId=$validId.ToString('B');task=([string]$task.TaskPath+[string]$task.TaskName)})
                    }else{$unknown++;$null=$unknownComClasses.Add($validId.ToString('B'))}
                }
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
    @{references=$references;unknown=$unknown;unknownComClasses=@($unknownComClasses);warnings=$warnings.ToArray();readOnly=$true}|ConvertTo-Json -Depth 4 -Compress
}catch{[Console]::Error.WriteLine('CLEANUP_REFERENCE_CHECK_FAILED');exit 2}
