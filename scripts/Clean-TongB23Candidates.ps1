# Exact B2.3 historical restore-candidate cleanup (Windows PS7).
# Check is read-only; Clean is only for an independent local Windows shell.
[CmdletBinding()]
param([ValidateSet('Check','Clean')][string]$Mode='Check')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$base='D:\Tong\state\b23-release-fgKPTn'
$runtime='D:\Tong\runtime'
$releasePin='D:\Tong\state\b23-login-70f1b7d66215458c8ffa0d822348de0f\startup-recovery-3bdc9693e71f49e2bafc7e5372b5bb20\release'
$versions=@(
 @{short='58786f6';commit='58786f601ceb8c7f3842225697adfb5e4034a73f';count=62},
 @{short='9589698';commit='9589698864e70a61299e839c34ab5ab1b8677bf9';count=95}
)
$allowed=@('config','demo-workspace','docs','native','node_modules','scripts','temp','tests','.gitignore','package-lock.json','package.json','README.md','release-restore-evidence.json')
function Deny([string]$reason){throw "CLEANUP_REFUSED:$reason"}
function Is-Plain([string]$path,[bool]$directory){
 if(-not(Test-Path -LiteralPath $path)){Deny "Missing:$path"}
 $x=Get-Item -LiteralPath $path -Force
 if([bool]$x.PSIsContainer -ne $directory -or ($x.Attributes -band [IO.FileAttributes]::ReparsePoint)){Deny "UnsafeItem:$path"}
}
function Hash([string]$path){(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
Is-Plain $base $true
Is-Plain (Join-Path $base 'npm-cache') $true
Is-Plain (Join-Path $base 'npm-cache\_cacache') $true
$s=Get-Content "$runtime\run\runtime.json" -Raw|ConvertFrom-Json
if($s.phase -cne 'ready'){Deny 'TongNotReady'}
if([string](Get-ScheduledTask -TaskName TongLoginRuntime).State -cne 'Running'){Deny 'TaskNotRunning'}
if(@(Get-Process TongLoginHost -ErrorAction SilentlyContinue).Count -ne 1){Deny 'HostChanged'}
foreach($name in @('release-pin.json','manager-pin.json')){
 $p=Get-Content "$runtime\run\$name" -Raw|ConvertFrom-Json
 if($p.commit -cne 'b9fe80150f9cdea47130e8952e85e39503187677' -or $p.releaseRoot -cne $releasePin){Deny 'ProductionPinChanged'}
}
$targets=@($versions|ForEach-Object {Join-Path $base ('candidate-'+$_.short)})
foreach($t in (Get-ScheduledTask)){
 foreach($a in $t.Actions){
  $exe=if($a.PSObject.Properties['Execute']){[string]$a.Execute}else{''}
  $argsText=if($a.PSObject.Properties['Arguments']){[string]$a.Arguments}else{''}
  $wd=if($a.PSObject.Properties['WorkingDirectory']){[string]$a.WorkingDirectory}else{''}
  $v=$exe+' '+$argsText+' '+$wd
  foreach($target in $targets){if($v.IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0){Deny "TaskRef:$($t.TaskName)"}}
 }
}
foreach($svc in (Get-CimInstance Win32_Service)){
 foreach($target in $targets){if(([string]$svc.PathName).IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0){Deny "ServiceRef:$($svc.Name)"}}
}
foreach($proc in (Get-CimInstance Win32_Process)){
 if($proc.ProcessId -eq $PID){continue}
 foreach($target in $targets){
  if(([string]$proc.ExecutablePath).IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0 -or ([string]$proc.CommandLine).IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0){Deny "ProcessRef:PID$($proc.ProcessId)"}
 }
}
$verified=@()
foreach($v in $versions){
 $target=Join-Path $base ('candidate-'+$v.short)
 $archive=Join-Path $base ('release-'+$v.short)
 Is-Plain $target $true
 Is-Plain $archive $true
 $m=Get-Content (Join-Path $archive 'release-manifest.json') -Raw|ConvertFrom-Json
 $e=Get-Content (Join-Path $target 'release-restore-evidence.json') -Raw|ConvertFrom-Json
 if($m.commit -cne $v.commit -or $e.commit -cne $v.commit -or $e.sourceFilesVerified -ne $v.count -or $e.patchChecked -ne $true -or $e.sqliteNativeLoaded -ne $true -or $e.lockedInstall -cne 'npm ci --ignore-scripts --offline' -or $e.nativeRestore -cne 'exact archived hashes'){Deny "RestoreEvidence:$($v.short)"}
 if(@(Get-ChildItem -LiteralPath $target -Force|Where-Object {$_.Name -cnotin $allowed}).Count){Deny "UnknownContents:$($v.short)"}
 $keep=@($m.files|Where-Object {$_.path -ceq 'code/source.tar' -or $_.path -ceq 'code/source/package-lock.json' -or $_.path -like 'native/node_modules/*'})
 if($keep.Count -lt 25){Deny "NativeArchiveMissing:$($v.short)"}
 foreach($item in $keep){
  $path=Join-Path $archive ($item.path -replace '/', '\')
  Is-Plain $path $false
  if((Hash $path) -cne [string]$item.sha256){Deny "ReleaseCorrupt:$($v.short)"}
 }
 $lock=@($m.files|Where-Object {$_.path -ceq 'code/source/package-lock.json'})[0]
 if((Hash (Join-Path $target 'package-lock.json')) -cne [string]$lock.sha256){Deny "LockMismatch:$($v.short)"}
 $entries=@(Get-ChildItem -LiteralPath $target -Recurse -Force)
 if(@($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){Deny "ReparseInCandidate:$($v.short)"}
 $files=@($entries|Where-Object {-not $_.PSIsContainer})
 $bytes=($files|Measure-Object Length -Sum).Sum
 $verified+= [pscustomobject]@{path=$target;bytes=[long]$bytes;fileCount=$files.Count;archive=$archive;commit=$v.commit}
}
if($Mode -eq 'Check'){
 [pscustomobject]@{mode=$Mode;ready=$true;runId=$s.runId;targetCount=$verified.Count;totalBytes=[long](($verified|Measure-Object bytes -Sum).Sum);targets=$verified}|ConvertTo-Json -Depth 6
 exit 0
}
$dir=Join-Path $env:LOCALAPPDATA 'Tong\CleanupHistory'
[void][IO.Directory]::CreateDirectory($dir)
$log=Join-Path $dir 'batch2-exact-candidates.jsonl'
foreach($target in $verified){
 $entry=[ordered]@{at=[DateTime]::UtcNow.ToString('o');path=$target.path;bytes=$target.bytes;archive=$target.archive;result='pending'}
 try{
  Remove-Item -LiteralPath $target.path -Recurse -ErrorAction Stop
  if(Test-Path -LiteralPath $target.path){Deny 'DeleteVerificationFailed'}
  $entry.result='deleted'
 }catch{
  $entry.result='failed'
  [IO.File]::AppendAllText($log,($entry|ConvertTo-Json -Compress)+[char]10)
  throw
 }
 [IO.File]::AppendAllText($log,($entry|ConvertTo-Json -Compress)+[char]10)
 [pscustomobject]$entry|Format-List
}
'Finished. Original release archives and npm cache were retained.'