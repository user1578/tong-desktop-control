# Uses only an already registered synthetic Task. Never registers a Task and
# never addresses the production TongLoginRuntime task or services.
param([switch]$Communication,[switch]$ExerciseCrash,[string]$SimulationRoot,[switch]$MediumIntegrityHost,[string]$SyntheticTaskName)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if($ExerciseCrash -and -not $Communication){throw 'COMMUNICATION_REQUIRED_FOR_CRASH_TEST'}
$root=if($SimulationRoot){$SimulationRoot}else{([IO.File]::ReadAllText((Join-Path $project 'artifacts\024-recovery\seven-file-prep-current.local.json'))|ConvertFrom-Json).root}
if($root -cnotmatch ('^'+[regex]::Escape('D:\Tong\state\b23-login-')+'[a-f0-9]{32}$')){throw 'ISOLATION_ROOT_DENIED'}
$marker=[IO.File]::ReadAllText((Join-Path $root 'seven-file-preparation.json'))|ConvertFrom-Json
if($marker.scope -cne 'seven-file-preparation-isolation'){throw 'ISOLATION_MARKER_REQUIRED'}
$env:TEMP=Join-Path $root 'temp';$env:TMP=$env:TEMP
# Reuse the existing native handle observer, including creation-time checks.
# Process.GetProcessById(...).ExitCode is null for these unowned processes.
$observer=[regex]::Match([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Test-Tong024FormalMonitor.ps1')),"Add-Type -TypeDefinition @'([\s\S]*?)'@").Groups[1].Value
if(-not $observer.Contains('public static class Tong024DoctorObserver')){throw 'NATIVE_OBSERVER_SOURCE_CHANGED'}
Add-Type -TypeDefinition $observer
$existing='D:\Tong\state\b23-login-68009b23f4794f16a6a9e03b1510f65a'
$monitor=Join-Path $existing 'login-management';$hostPath=Join-Path $monitor 'TongLoginHost.exe';$runnerPath=Join-Path $monitor 'TongLoginRuntime.ps1'
$trial=[guid]::NewGuid().ToString('N');$saved=Join-Path $root ('task-originals-'+$trial);$null=[IO.Directory]::CreateDirectory($saved)
function Hash([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Check([bool]$Ok,[string]$Code){if(-not $Ok){throw $Code}}
function Worker([string]$Action){$raw=& D:\node\node.exe (Join-Path $PSScriptRoot 'Test-TongSevenFilePreparation.mjs') $Action $root;if($LASTEXITCODE -ne 0){throw ('WORKER_'+$Action+'_FAILED')};return ($raw|ConvertFrom-Json)}
function Identity($Process){return @{pid=[int]$Process.ProcessId;exe=[string]$Process.ExecutablePath;startTicks=$Process.CreationDate.ToUniversalTime().Ticks.ToString();parentPid=[int]$Process.ParentProcessId}}
$scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect()
$defaultTaskName='Tong024StateRepair-5dc9bd7a-3318-43dd-800c-ff0fab62f8ac'
if($SyntheticTaskName){
 Check ($ExerciseCrash -and $SyntheticTaskName -cmatch '^TongCommRecovery-[a-f0-9]{32}$') 'SYNTHETIC_RECOVERY_TASK_REQUIRED'
 $originalTask=$scheduler.GetFolder('\').GetTask($defaultTaskName)
 Check (-not $originalTask.Enabled -and @($originalTask.GetInstances(0)).Count -eq 0) 'OTHER_SYNTHETIC_TASK_RUNNING'
}
$task=$scheduler.GetFolder('\').GetTask($(if($SyntheticTaskName){$SyntheticTaskName}else{$defaultTaskName}))
if($SyntheticTaskName){Check ($task.Definition.Triggers.Count -eq 0 -and $task.Definition.Settings.ExecutionTimeLimit -ceq 'PT7M') 'RECOVERY_TASK_LIMIT_CHANGED'}
Check (-not $task.Enabled -and @($task.GetInstances(0)).Count -eq 0) 'TEST_TASK_NOT_QUIESCENT'
Check ($task.Definition.Actions.Count -eq 1 -and $task.Definition.Actions.Item(1).Path -ceq $hostPath -and $task.Definition.Actions.Item(1).WorkingDirectory -ceq $existing) 'TEST_TASK_ACTION_CHANGED'
$taskXmlHash=[Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($task.Xml)))
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskUser=$task.Definition.Principal.UserId
$taskSid=if($taskUser -like 'S-1-*'){$taskUser}else{([Security.Principal.NTAccount]::new($taskUser)).Translate([Security.Principal.SecurityIdentifier]).Value}
Check ($taskSid -ceq $sid -and $task.Definition.Principal.LogonType -eq 3 -and $task.Definition.Principal.RunLevel -eq 0 -and $task.Definition.Settings.MultipleInstances -eq 2) 'TEST_TASK_PRINCIPAL_CHANGED'
$mutex=[Threading.Mutex]::new($false,('Local\TongSevenFilePrep-'+$sid));$held=$false;$started=$false;$installed=$false;$ready=$null;$outcome=$null;$chain=@{}
try{
 try{$held=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true};Check $held 'ISOLATED_LIFECYCLE_BUSY'
 $self=Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)
 $parent=Get-CimInstance Win32_Process -Filter ('ProcessId='+$self.ParentProcessId)
 $controller=if($Communication){Join-Path $saved 'controller.json'}else{Join-Path $root 'controller.json'}
 [IO.File]::WriteAllText($controller,(@{pid=$PID;identity=Identity $self;parentObserver=Identity $parent;mutexHeld=$true;mutex='Local\TongSevenFilePrep';taskDisabled=$true;taskInstances=0}|ConvertTo-Json -Depth 4))
 if($Communication){$env:TONG_TEST_CONTROLLER=$controller}
 if($Communication -and [IO.File]::Exists((Join-Path $root 'run\login-recovery-budget.json'))){[IO.File]::Copy((Join-Path $root 'run\login-recovery-budget.json'),(Join-Path $saved 'budget.before.json'),$false)}
 $freshCommunication=$Communication -and $marker.PSObject.Properties['communicationFixture'] -and $marker.communicationFixture
 if($Communication -and -not $freshCommunication){Check ([IO.File]::Exists((Join-Path $root 'run\runtime.json')) -and [IO.File]::Exists((Join-Path $root 'legacy-handoff-result.json'))) 'PREPARED_STOPPED_FIXTURE_REQUIRED'}
 if($freshCommunication){if([IO.File]::Exists((Join-Path $root 'run\runtime.json'))){$null=Worker 'verify-stopped'}else{Check (-not [IO.File]::Exists((Join-Path $root 'run\request.json'))) 'FRESH_FIXTURE_REQUEST_PRESENT'}}
 elseif([IO.File]::Exists((Join-Path $root 'run\runtime.json')) -and [IO.File]::Exists((Join-Path $root 'legacy-handoff-result.json'))){$null=Worker 'verify-stopped'}
 elseif([IO.File]::Exists((Join-Path $root 'legacy-handoff-result.json'))){$legacy=& D:\node\node.exe (Join-Path $PSScriptRoot 'Test-TongBe3LegacyHandoff.mjs') verify-retired;Check ($LASTEXITCODE -eq 0) 'LEGACY_HANDOFF_REFUSED'}else{$legacy=& D:\node\node.exe (Join-Path $PSScriptRoot 'Test-TongBe3LegacyHandoff.mjs');Check ($LASTEXITCODE -eq 0) 'LEGACY_HANDOFF_REFUSED'}
 if($Communication){$null=Worker 'grant'}
 Check (-not $task.Enabled -and @($task.GetInstances(0)).Count -eq 0) 'TEST_TASK_RACED'
 $hostSource=Join-Path $existing 'monitor-88ca27ee-e599-4482-b849-7c96923272fb\TongLoginHost.exe'
 Check ((Hash $hostSource) -ceq '28d5db5e41d7ea079550d04377f383dc858dd126f57ce9a1b1f51cea00d33718') 'VERIFIED_PS7_HOST_CHANGED'
 $originalHashes=@{host=$(if([IO.File]::Exists($hostPath)){Hash $hostPath}else{$null});runner=$(if([IO.File]::Exists($runnerPath)){Hash $runnerPath}else{$null})}
 if($originalHashes.host){[IO.File]::Move($hostPath,(Join-Path $saved 'TongLoginHost.exe'))};if($originalHashes.runner){[IO.File]::Move($runnerPath,(Join-Path $saved 'TongLoginRuntime.ps1'))};$installed=$true
 [IO.File]::Copy($hostSource,$hostPath,$false)
 if($MediumIntegrityHost){
  & (Join-Path $project 'scripts\Set-TongLoginHostIntegrity.ps1') -Path $hostPath -ExpectedSha256 '28d5db5e41d7ea079550d04377f383dc858dd126f57ce9a1b1f51cea00d33718' | Out-Null
 }
 $source=[IO.File]::ReadAllText((Join-Path $root 'releases\manager\scripts\TongLoginRuntime.ps1'))
 Check ($source.Split("`$runtime='D:\Tong\runtime'").Count -eq 2) 'RUNNER_FIXED_ROOT_CHANGED'
 $source=$source.Replace("`$runtime='D:\Tong\runtime'","`$runtime='$root'").Replace('Local\TongLoginRuntime-','Local\TongSevenFilePrep-')
 [IO.File]::WriteAllText($runnerPath,$source,[Text.UTF8Encoding]::new($false))
 $mutex.ReleaseMutex();$held=$false
 $began=[DateTime]::UtcNow;$task.Enabled=$true;$started=$true;$instance=$task.Run($null)
 $chain=@{};$healthy=$null;$deadline=$began.AddSeconds(180)
 while([DateTime]::UtcNow -lt $deadline){
  $instances=@($task.GetInstances(0));Check ($instances.Count -le 1) 'MULTIPLE_TASK_INSTANCES'
  if($instances.Count -eq 1){
   $hostProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$instances[0].EnginePID)
   if($hostProcess -and $hostProcess.ExecutablePath -ieq $hostPath){
    $chain.host=Identity $hostProcess
    $runners=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$hostProcess.ProcessId)|Where-Object {$_.ExecutablePath -ieq 'C:\Program Files\PowerShell\7\pwsh.exe' -and $_.CommandLine.Contains($runnerPath)})
    Check ($runners.Count -le 1) 'MULTIPLE_RUNNERS'
    if($runners.Count -eq 1){
     $runner=$runners[0];$chain.runner=Identity $runner
     foreach($p in @(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$runner.ProcessId))){
      if($p.ExecutablePath -ieq 'D:\node\node.exe' -and $p.CommandLine.Contains($root+'\releases\manager\scripts\TongAgentDockRuntime.mjs') -and $p.CommandLine.Contains(' start ')){
       $chain.manager=Identity $p
       foreach($l in @(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$p.ProcessId))){if($l.CommandLine -and $l.CommandLine.Contains($root+'\releases\manager\scripts\TongRuntimeLaunch.ps1')){$chain.launcher=Identity $l}}
      }
     }
    }
   }
  }
  $log=Join-Path $root 'logs\login-management.jsonl'
  if($chain.ContainsKey('runner') -and [IO.File]::Exists($log)){$events=@([IO.File]::ReadAllLines($log)|ForEach-Object{$_|ConvertFrom-Json}|Where-Object {$_.runnerPid -eq $chain.runner.pid -and $_.event -ceq 'runtime_healthy' -and ([DateTime]$_.at).ToUniversalTime() -ge $began});if($events.Count){$healthy=$events[-1];break}}
  if(-not $instances.Count -and ([DateTime]::UtcNow-$began).TotalSeconds -gt 3){throw 'TEST_TASK_EARLY_EXIT'}
  Start-Sleep -Milliseconds 500
 }
 Check ($null -ne $healthy -and $chain.ContainsKey('launcher')) 'COMPLETE_TASK_START_UNPROVEN'
 $ready=Worker $(if($ExerciseCrash){'ready-receipts'}else{'status'});Check ($ready.runId -ceq $healthy.runId -and ($ExerciseCrash -or $ready.healthy)) 'DOCTOR_NOT_HEALTHY'
 Check ($ready.launcher.launcher.pid -eq $chain.launcher.pid -and $ready.launcher.launcher.startTicks -ceq $chain.launcher.startTicks) 'LAUNCHER_IDENTITY_CHANGED'
 $guardian=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ready.guardian.pid);$supervisor=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ready.supervisor.pid)
 Check ($guardian.ParentProcessId -eq $chain.launcher.pid -and $guardian.CreationDate.ToUniversalTime().Ticks.ToString() -ceq $ready.guardian.startTicks) 'GUARDIAN_PARENT_UNPROVEN'
 Check ($supervisor.ParentProcessId -eq $guardian.ProcessId -and $supervisor.CreationDate.ToUniversalTime().Ticks.ToString() -ceq $ready.supervisor.startTicks) 'SUPERVISOR_PARENT_UNPROVEN'
 $chain.guardian=Identity $guardian;$chain.supervisor=Identity $supervisor
 Check ($ready.guardian.containment -ceq 'create_process_job_list') 'ATOMIC_CONTAINMENT_UNPROVEN'
 if($MediumIntegrityHost){
  $devspace=@($ready.children|Where-Object role -eq 'devspace')[0]
  $snapshot=& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoLogo -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'fixtures\TongWindowsAccessSnapshot.ps1') -TargetPid $devspace.pid -StateDirectory (Join-Path $root 'tong\oauth')
  Check ($LASTEXITCODE -eq 0) 'DEVSPACE_TOKEN_UNAVAILABLE'
  $access=$snapshot|ConvertFrom-Json
  Check ($access.target.integritySid -ceq 'S-1-16-8192' -and $access.integrityLabel -match ';;;ME\)') 'MEDIUM_RUNTIME_STATE_MISMATCH'
  [IO.File]::WriteAllText((Join-Path $saved 'devspace-access.json'),($snapshot -join "`n"))
 }
 $periodic=$null;$doctorExit=$null
 if(-not $ExerciseCrash){
  $deadline=[DateTime]::UtcNow.AddSeconds(35)
  while([DateTime]::UtcNow -lt $deadline){$doctors=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$chain.runner.pid)|Where-Object {$_.CommandLine -and $_.CommandLine.Contains(' doctor ') -and $_.CommandLine.Contains($root)});if($doctors.Count -eq 1){$periodic=$doctors[0];break};Start-Sleep -Milliseconds 150}
  Check ($null -ne $periodic) 'PERIODIC_DOCTOR_UNOBSERVED'
  $doctorExit=[Tong024DoctorObserver]::Exit([int]$periodic.ProcessId,$periodic.ExecutablePath,$periodic.CreationDate.ToUniversalTime().Ticks)
  Check ($doctorExit -eq 0) 'PERIODIC_DOCTOR_FAILED'
 }
 $communicationResult=$null
 if($Communication -and -not $ExerciseCrash){
  $raw=& D:\node\node.exe (Join-Path $PSScriptRoot 'Test-TongCommunicationFiles.mjs') $root $ready.runId $saved
  Check ($LASTEXITCODE -eq 0) 'AUTHENTICATED_FILE_ACCEPTANCE_FAILED'
  $communicationResult=$raw|ConvertFrom-Json
 }
 $crashResult=$null
 if($ExerciseCrash){
  [IO.File]::WriteAllText((Join-Path $saved 'crash-origin.json'),(@{runner=$chain.runner;initialHealthyEvent=$healthy}|ConvertTo-Json -Depth 5))
  $raw=& D:\node\node.exe (Join-Path $PSScriptRoot 'Test-TongCommunicationCrash.mjs') $root $ready.runId $saved
  Check ($LASTEXITCODE -eq 0) 'CONTROLLED_CRASH_RECOVERY_FAILED'
  $crashResult=$raw|ConvertFrom-Json
 }
 $stopped=Worker 'stop';$deadline=[DateTime]::UtcNow.AddSeconds(35)
 while(@($task.GetInstances(0)).Count -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 200}
 Check (@($task.GetInstances(0)).Count -eq 0 -and $task.LastTaskResult -eq 0) 'TASK_NORMAL_STOP_UNPROVEN'
 $started=$false;$task.Enabled=$false
 $null=Worker 'revoke'
 $outcome=@{passed=$true;root=$root;task=$task.Name;taskDefinitionChanged=$false;chain=$chain;runId=$ready.runId;ready=$true;doctorHealthy=$(if($ExerciseCrash){$crashResult.doctorHealthy}else{$ready.healthy});health=$ready.health;launcherPreflight=$ready.launcher.preflight;guardianPreflight=$ready.guardianReceipt.preflight;atomicContainment=$ready.guardian.containment;periodicDoctor=$(if($null -ne $periodic){Identity $periodic}else{$null});periodicDoctorExit=$doctorExit;normalStop=$stopped;taskExit=0;testCommit=$marker.testCommit;exactCandidate=$marker.exactCommit;productionChanged=$false;productionExecutionAllowed=$false}
 if($Communication){
  $outcome.communication=$communicationResult;$outcome.crashRecovery=$crashResult;$outcome.taskStartedAt=$began.ToString('o')
  $outcome.taskToHealthyMs=(([datetime]$healthy.at).ToUniversalTime()-$began).TotalMilliseconds
  Check ($outcome.taskToHealthyMs -ge 0 -and $outcome.taskToHealthyMs -le 180000) 'TASK_HEALTHY_TIME_INVALID'
  $request=[IO.File]::ReadAllText((Join-Path $root 'run\request.json'))|ConvertFrom-Json -DateKind String
  # A crash replaces the active request. Bind this metric to that recovered
  # run explicitly rather than presenting it as the initial cold-start time.
  $outcome.requestToReadyRunId=$request.runId
  Check ($request.runId -ceq $(if($ExerciseCrash){$crashResult.recoveredRunId}else{$ready.runId})) 'STARTUP_METRICS_RUN_MISMATCH'
  $readyEvent=@([IO.File]::ReadAllLines((Join-Path $root 'logs\lifecycle.jsonl'))|ForEach-Object {$_|ConvertFrom-Json -DateKind String}|Where-Object {$_.PSObject.Properties['runId'] -and $_.runId -eq $request.runId -and $_.event -eq 'ready'})[-1]
  $outcome.requestToReadyMs=([DateTimeOffset]::Parse($readyEvent.at)-[DateTimeOffset]::Parse($request.createdAt)).TotalMilliseconds
  Check ($outcome.requestToReadyMs -ge 0 -and $outcome.requestToReadyMs -le 120000) 'STARTUP_BUDGET_EXCEEDED'
 }
 $readyPath=if($Communication){Join-Path $saved 'task-ready.json'}else{Join-Path $root 'task-ready.json'}
 [IO.File]::WriteAllText($readyPath,($ready|ConvertTo-Json -Depth 12))
}catch{
 $code=if($_.Exception.Message -cmatch '^[A-Z_]{1,80}$'){$_.Exception.Message}else{'TEST_HARNESS_FAILED'}
 if($null -ne $outcome){$outcome.passed=$false;$outcome.failure=$code}
 [IO.File]::WriteAllText((Join-Path $root ('task-failure-'+$trial+'.json')),(@{passed=$false;code=$code;chain=$chain;productionChanged=$false}|ConvertTo-Json -Depth 6));throw
}finally{
 $task.Enabled=$false
 if($started){try{$null=Worker 'stop'}catch{[Console]::Error.WriteLine('Isolated stop proof unavailable; preserve closed Task and evidence.')}}
 if($installed -and @($task.GetInstances(0)).Count -eq 0){
  if([IO.File]::Exists($hostPath)){[IO.File]::Move($hostPath,(Join-Path $saved 'used-TongLoginHost.exe'))}
  if([IO.File]::Exists($runnerPath)){[IO.File]::Move($runnerPath,(Join-Path $saved 'used-TongLoginRuntime.ps1'))}
  if($originalHashes.host){[IO.File]::Move((Join-Path $saved 'TongLoginHost.exe'),$hostPath);Check ((Hash $hostPath) -ceq $originalHashes.host) 'TEST_HOST_RESTORE_FAILED'}else{Check (-not [IO.File]::Exists($hostPath)) 'TEST_HOST_ABSENCE_NOT_RESTORED'}
  if($originalHashes.runner){[IO.File]::Move((Join-Path $saved 'TongLoginRuntime.ps1'),$runnerPath);Check ((Hash $runnerPath) -ceq $originalHashes.runner) 'TEST_RUNNER_RESTORE_FAILED'}else{Check (-not [IO.File]::Exists($runnerPath)) 'TEST_RUNNER_ABSENCE_NOT_RESTORED'}
 }
 if($held){$mutex.ReleaseMutex()};$mutex.Dispose()
 Check (@($task.GetInstances(0)).Count -eq 0) 'ISOLATED_TASK_STILL_RUNNING'
 Check ([Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($task.Xml))) -ceq $taskXmlHash) 'TEST_TASK_DEFINITION_CHANGED'
 if($outcome){$outcome.testTaskDisabled=$true;$outcome.originalTestHostRestored=$true;$outcomePath=if($Communication){Join-Path $saved 'task-outcome.json'}else{Join-Path $root 'task-outcome.json'};[IO.File]::WriteAllText($outcomePath,($outcome|ConvertTo-Json -Depth 10));$outcome|ConvertTo-Json -Depth 10 -Compress}
}
