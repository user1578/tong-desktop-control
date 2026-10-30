# Tong Desktop Control - independent read-only health watcher (PowerShell 7)
# Run Start from your own Windows PowerShell 7 console, NOT from a Tong-managed job.
[CmdletBinding()]
param(
    [ValidateSet('Run','Start','Status','Stop')][string]$Mode='Status',
    [ValidateRange(2,3600)][int]$IntervalSeconds=10,
    [ValidateRange(0,100000)][int]$MaxSamples=0,
    [string]$RuntimeRoot='D:\Tong\runtime',
    [string]$LogRoot=(Join-Path $env:LOCALAPPDATA 'Tong\HealthMonitor')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Utf8=[Text.UTF8Encoding]::new($false)
$OwnerFile=Join-Path $LogRoot 'owner.json'
$LogFile=Join-Path $LogRoot 'health.jsonl'
$Script:Offsets=@{}
$Script:PrevState=$null
$Script:ProbeCycle=0
$Script:Probe=@{gateway=$null;ngrokApi=$null}
$LogNames=@('login-management.jsonl','lifecycle.jsonl','supervisor.jsonl','guardian.jsonl','production.login-recovery.audit.jsonl')
function Read-Json([string]$path) {
    if(-not [IO.File]::Exists($path)){return $null}
    return [IO.File]::ReadAllText($path,$Utf8)|ConvertFrom-Json -ErrorAction Stop
}
function Safe-Upper($value){
    $s=[string]$value
    if($s -cmatch '^[A-Z_]{1,64}$'){return $s}
    return $null
}
function Safe-Label($value){
    $s=[string]$value
    if($s -cmatch '^[a-z][a-z0-9_]{0,63}$'){return $s}
    return $null
}
function Safe-RunId($value) {
    $s=[string]$value
    if($s -match '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$'){return $s}
    return $null
}
function Emit([string]$type,[hashtable]$data=@{}) {
    $row=[ordered]@{utc=[DateTime]::UtcNow.ToString('o');type=$type}
    foreach($k in $data.Keys){$row[$k]=$data[$k]}
    $json=ConvertTo-Json -InputObject $row -Depth 6 -Compress
    if([IO.File]::Exists($LogFile) -and ([IO.FileInfo]$LogFile).Length -ge 5MB){
        for($i=6;$i -ge 1;$i--){
            $src=if($i -eq 1){$LogFile}else{"$LogFile.$($i-1)"}
            $dst="$LogFile.$i"
            if([IO.File]::Exists($src)){[IO.File]::Move($src,$dst,$true)}
        }
    }
    [IO.File]::AppendAllText($LogFile,$json+[char]10,$Utf8)
}
function Get-Owner {try{return Read-Json $OwnerFile}catch{return $null}}
function Owner-Process($owner){
    if($null -eq $owner -or $null -eq $owner.pid -or $null -eq $owner.startUtc){return $null}
    try{
        $p=Get-Process -Id ([int]$owner.pid) -ErrorAction Stop
        if($p.ProcessName -ne 'pwsh'){return $null}
        $start=([datetime]$p.StartTime).ToUniversalTime()
        # ConvertFrom-Json on PS7 turns an ISO timestamp into DateTime.
        # Casting it back to [string] loses its zone on some cultures.
        $recorded=if($owner.startUtc -is [datetime]){
            ([datetime]$owner.startUtc).ToUniversalTime()
        }else{
            ([datetimeoffset]::Parse([string]$owner.startUtc)).UtcDateTime
        }
        if([Math]::Abs(($start-$recorded).TotalSeconds) -gt 2){return $null}
        return $p
    }catch{return $null}
}
if($Mode -eq 'Status'){
    $p=Owner-Process (Get-Owner)
    [pscustomobject]@{
        Running=($null -ne $p)
        Pid=if($null -ne $p){$p.Id}else{$null}
        LogPath=$LogFile
        LastWriteUtc=if([IO.File]::Exists($LogFile)){([IO.FileInfo]$LogFile).LastWriteTimeUtc.ToString('o')}else{$null}
    }|Format-List
    exit 0
}
if($Mode -eq 'Stop'){
    $p=Owner-Process (Get-Owner)
    if($null -eq $p){'Monitor is not running; no process stopped.';exit 0}
    Emit 'monitor_stop_requested' @{pid=$p.Id}
    Stop-Process -Id $p.Id -ErrorAction Stop
    "Stopped monitor PID $($p.Id). Tong was not touched."
    exit 0
}
if($Mode -eq 'Start'){
    $p=Owner-Process (Get-Owner)
    if($null -ne $p){"Monitor already running: $($p.Id)";exit 0}
    [void][IO.Directory]::CreateDirectory($LogRoot)
    $exe=(Get-Command pwsh -ErrorAction Stop).Source
    $file='"'+$PSCommandPath.Replace('"','')+'"'
    $rootArg='"'+$RuntimeRoot.Replace('"','')+'"'
    $logArg='"'+$LogRoot.Replace('"','')+'"'
    $argsLine="-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $file -Mode Run -RuntimeRoot $rootArg -LogRoot $logArg -IntervalSeconds $IntervalSeconds"
    $spawned=Start-Process -FilePath $exe -ArgumentList $argsLine -WindowStyle Hidden -PassThru
    $p=$null
    for($attempt=0;$attempt -lt 15;$attempt++){
        Start-Sleep -Seconds 1
        $p=Owner-Process (Get-Owner)
        if($null -ne $p){break}
        $spawned.Refresh()
        if($spawned.HasExited){break}
    }
    if($null -eq $p){throw "Monitor failed to start (spawn PID $($spawned.Id)); inspect $LogFile"}
    "Independent health monitor PID $($p.Id); log $LogFile"
    exit 0
}
[void][IO.Directory]::CreateDirectory($LogRoot)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value.Replace('-','_')
$mutex=[Threading.Mutex]::new($false,"Local\TongHealthMonitor_$sid")
$locked=$false
try{
    try{$locked=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
    if(-not $locked){throw 'Tong health monitor already running'}
    $mine=Get-Process -Id $PID
    [IO.File]::WriteAllText($OwnerFile,(@{pid=$PID;startUtc=$mine.StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress),$Utf8)
    Emit 'monitor_started' @{pid=$PID;interval=$IntervalSeconds;root=$RuntimeRoot}
    # Event cursors start at EOF; old source events are not misreported as new.
    foreach($n in $LogNames){
        $path=Join-Path (Join-Path $RuntimeRoot 'logs') $n
        $Script:Offsets[$n]=if([IO.File]::Exists($path)){([IO.FileInfo]$path).Length}else{0L}
    }
    function Read-NewEvents([string]$name){
        $path=Join-Path (Join-Path $RuntimeRoot 'logs') $name
        if(-not [IO.File]::Exists($path)){return}
        $fs=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        try{
            $from=[long]$Script:Offsets[$name]
            $length=$fs.Length
            if($length -lt $from){$from=0L;Emit 'source_rotated' @{source=$name}}
            if($length-$from -gt 131072){
                $from=$length-131072
                Emit 'source_gap' @{source=$name}
            }
            if($length -eq $from){$Script:Offsets[$name]=$from;return}
            [void]$fs.Seek($from,[IO.SeekOrigin]::Begin)
            $buffer=[byte[]]::new([int]($length-$from))
            $read=$fs.Read($buffer,0,$buffer.Length)
            $last=-1
            for($i=0;$i -lt $read;$i++){if($buffer[$i] -eq 10){$last=$i}}
            if($last -lt 0){return}
            $Script:Offsets[$name]=$from+$last+1
            $body=$Utf8.GetString($buffer,0,$last+1)
            foreach($line in ($body -split [char]10)){
                if([string]::IsNullOrWhiteSpace($line)){continue}
                try{
                    $e=$line|ConvertFrom-Json -ErrorAction Stop
                    $eventName=Safe-Label $e.event
                    if($null -eq $eventName){continue}
                    $entry=@{source=$name;event=$eventName}
                    if($e.PSObject.Properties['at']){
                        $dt=[datetimeoffset]::MinValue
                        if($e.at -is [datetime]){$entry['sourceUtc']=$e.at.ToUniversalTime().ToString('o')}
                        elseif([datetimeoffset]::TryParse([string]$e.at,[ref]$dt)){$entry['sourceUtc']=$dt.ToUniversalTime().ToString('o')}
                    }
                    if($e.PSObject.Properties['runId']){
                        $run=Safe-RunId $e.runId
                        if($null -ne $run){$entry['runId']=$run}
                    }
                    foreach($key in @('reason','phase','role','stage','kind','diagnosticStage','diagnosticKind','outputKind')){
                        if(-not $e.PSObject.Properties[$key] -or $null -eq $e.$key){continue}
                        $v=if($key -in @('reason','kind','diagnosticKind')){
                            $code=Safe-Upper $e.$key
                            if($null -ne $code){$code}else{Safe-Label $e.$key}
                        }else{Safe-Label $e.$key}
                        if($null -ne $v){$entry[$key]=$v}
                    }
                    if($e.PSObject.Properties['managerAction'] -and [string]$e.managerAction -cmatch '^(status|start|stop-run|doctor|reconcile-stale|preflight-login)$'){$entry['managerAction']=[string]$e.managerAction}
                    if($e.PSObject.Properties['managerStage'] -and [string]$e.managerStage -cmatch '^(entry|grant_load|envelope_paths|envelope_unseal|descriptor_validate|audit_paths|audit_load|audit_validate|release_verify|operation_audit|handler|doctor_layout|doctor_status|binary_hash|agentdock_health|tong_health|security_inspect|result_ready|output_written|unspecified)$'){$entry['managerStage']=[string]$e.managerStage}
                    if($e.PSObject.Properties['invocationId']){$call=Safe-RunId $e.invocationId;if($call){$entry['invocationId']=$call}}
                    if($e.PSObject.Properties['exitHex'] -and [string]$e.exitHex -cmatch '^0x[A-F0-9]{8}$'){$entry['exitHex']=[string]$e.exitHex}
                    foreach($key in @('managerPid','managerParentPid','runnerPid')){
                        if($e.PSObject.Properties[$key] -and ($e.$key -is [int] -or $e.$key -is [long]) -and $e.$key -gt 0 -and $e.$key -le [int]::MaxValue){$entry[$key]=[int]$e.$key}
                    }
                    foreach($key in @('nativeExitCode','exitCode')){
                        if($e.PSObject.Properties[$key] -and $e.$key -is [int] -or $e.PSObject.Properties[$key] -and $e.$key -is [long]){$entry[$key]=[long]$e.$key}
                    }
                    Emit 'source_event' $entry
                }catch{Emit 'source_parse_error' @{source=$name}}
            }
        }finally{$fs.Dispose()}
    }
    function Probe-LocalEndpoints {
        # No credentials or internet requests; one bounded local check per minute.
        foreach($probe in @(
            @{key='gateway';url='http://127.0.0.1:7676/.well-known/oauth-authorization-server'},
            @{key='ngrokApi';url='http://127.0.0.1:4040/api/tunnels'}
        )){
            $ok=$false
            try{
                $response=Invoke-WebRequest -Uri $probe.url -Method Get -NoProxy -TimeoutSec 3 -SkipHttpErrorCheck
                $ok=([int]$response.StatusCode -eq 200)
            }catch{}
            $Script:Probe[$probe.key]=$ok
        }
        Emit 'endpoint_probe' @{gateway=$Script:Probe.gateway;ngrokLocalApi=$Script:Probe.ngrokApi}
    }
    function Sample {
        $runtime=$null;$guardian=$null
        $errors=[System.Collections.Generic.List[string]]::new()
        try{$runtime=Read-Json (Join-Path $RuntimeRoot 'run\runtime.json')}catch{$errors.Add('runtime_json')}
        try{$guardian=Read-Json (Join-Path $RuntimeRoot 'run\guardian.json')}catch{$errors.Add('guardian_json')}
        $taskState='UNAVAILABLE'
        try{$taskState=[string](Get-ScheduledTask -TaskName TongLoginRuntime -ErrorAction Stop).State}catch{$errors.Add('task_query')}
        $hosts=@(Get-Process -Name TongLoginHost -ErrorAction SilentlyContinue)
        $ngrokService=Get-Service -Name ngrok -ErrorAction SilentlyContinue
        $super=$null;$guard=$null
        if($null -ne $runtime -and $null -ne $runtime.supervisor -and $runtime.supervisor.pid){$super=Get-Process -Id ([int]$runtime.supervisor.pid) -ErrorAction SilentlyContinue}
        if($null -ne $guardian -and $guardian.pid){$guard=Get-Process -Id ([int]$guardian.pid) -ErrorAction SilentlyContinue}
        $ports=@()
        try{$ports=@(Get-NetTCPConnection -State Listen -ErrorAction Stop|Where-Object {$_.LocalPort -in @(7676,7677,18765)}|Select-Object -ExpandProperty LocalPort -Unique|Sort-Object)}catch{$errors.Add('tcp_query')}
        $phase=if($null -ne $runtime){Safe-Label $runtime.phase}else{$null}
        $run=if($null -ne $runtime){Safe-RunId $runtime.runId}else{$null}
        $guardianRun=if($null -ne $guardian){Safe-RunId $guardian.runId}else{$null}
        $healthy=($phase -ceq 'ready' -and $taskState -eq 'Running' -and $hosts.Count -eq 1 -and $null -ne $super -and $null -ne $guard -and $run -eq $guardianRun -and $ports.Count -eq 3 -and $errors.Count -eq 0)
        $entry=@{
            healthy=$healthy;phase=$phase;runId=$run;task=$taskState
            ngrokService=if($null -ne $ngrokService){[string]$ngrokService.Status}else{'UNAVAILABLE'}
            gatewayHttp=$Script:Probe.gateway;ngrokLocalApi=$Script:Probe.ngrokApi
            hostCount=$hosts.Count;hostPid=if($hosts.Count -eq 1){$hosts[0].Id}else{$null}
            supervisorPid=if($null -ne $super){$super.Id}else{$null}
            guardianPid=if($null -ne $guard){$guard.Id}else{$null}
            supervisorMemoryMB=if($null -ne $super){[int]($super.WorkingSet64/1MB)}else{$null}
            ports=@($ports);checkErrors=@($errors.ToArray())
        }
        Emit 'sample' $entry
        $state=if($healthy){'HEALTHY'}elseif($errors.Count){'MONITOR_DEGRADED'}else{'TONG_UNHEALTHY'}
        if($Script:PrevState -cne $state){
            Emit 'health_transition' @{from=$Script:PrevState;to=$state;phase=$phase;runId=$run}
            $Script:PrevState=$state
        }
    }
    $count=0
    while($true){
        try{
            if($Script:ProbeCycle % 6 -eq 0){Probe-LocalEndpoints}
            $Script:ProbeCycle++
            Sample
            foreach($n in $LogNames){
                try{Read-NewEvents $n}catch{Emit 'monitor_read_error' @{source=$n;kind='READ_FAILURE'}}
            }
        }catch{Emit 'monitor_error' @{kind='SAMPLE_FAILURE'}}
        $count++
        if($MaxSamples -gt 0 -and $count -ge $MaxSamples){break}
        Start-Sleep -Seconds $IntervalSeconds
    }
    Emit 'monitor_completed' @{samples=$count}
}finally{
    if($locked){
        try{
            $owner=Get-Owner
            if($null -ne $owner -and [int]$owner.pid -eq $PID){[IO.File]::Delete($OwnerFile)}
        }catch{}
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
