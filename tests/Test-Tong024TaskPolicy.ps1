$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# A command-only, read-only diagnostic. Never invokes/dot-sources a runner.
$id=[guid]::NewGuid().ToString();$root=Join-Path 'D:\Tong\state' ('b23-task-policy-'+$id)
$null=[IO.Directory]::CreateDirectory($root);$output=Join-Path $root 'policy.json'
$command="[ordered]@{pid=`$PID;is64Bit=[Environment]::Is64BitProcess;policy=(Get-ExecutionPolicy).ToString();policies=@(Get-ExecutionPolicy -List|ForEach-Object{@{scope=`$_.Scope.ToString();policy=`$_.ExecutionPolicy.ToString()}});processPolicy=[Environment]::GetEnvironmentVariable('PSExecutionPolicyPreference','Process');sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value}|ConvertTo-Json -Depth 5 -Compress|Set-Content -LiteralPath '$output' -Encoding UTF8"
$scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();$folder=$scheduler.GetFolder('\')
$definition=$scheduler.NewTask(0);$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$definition.Principal.UserId=$sid;$definition.Principal.LogonType=3;$definition.Principal.RunLevel=0
$definition.Settings.MultipleInstances=2;$definition.Settings.ExecutionTimeLimit='PT1M'
$definition.RegistrationInfo.Description='Tong 024 read-only execution-policy context diagnostic; no runner execution.'
$action=$definition.Actions.Create(0);$action.Path=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe';$action.Arguments='-NoLogo -NoProfile -NonInteractive -Command "'+$command+'"';$action.WorkingDirectory=$root
$task=$null
try{
 $task=$folder.RegisterTaskDefinition(('Tong024Acceptance-'+$id),$definition,2,$sid,$null,3)
 $null=$task.Run($null);$until=[DateTime]::UtcNow.AddSeconds(20)
 while((-not [IO.File]::Exists($output) -or @($task.GetInstances(0)).Count -gt 0) -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 100}
 if(-not [IO.File]::Exists($output) -or @($task.GetInstances(0)).Count -gt 0 -or $task.LastTaskResult -ne 0){throw 'TASK_POLICY_DIAGNOSTIC_FAILED'}
 @{root=$root;task=$task.Name;lastTaskResult=$task.LastTaskResult;diagnostic=(Get-Content -LiteralPath $output -Raw|ConvertFrom-Json);productionMutation=$false}|ConvertTo-Json -Depth 8 -Compress
}finally{if($null -ne $task){$task.Enabled=$false}}
